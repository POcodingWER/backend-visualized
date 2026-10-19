'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  authApi,
  errorReason,
  isSession,
  REASON_KO,
  shortToken,
  type RefreshTokenRow,
  type Session,
} from '../../lib/auth-api';
import styles from './auth.module.css';
import type { AddLogEntry } from './types';

const STATUS_KO: Record<RefreshTokenRow['status'], string> = {
  active: '활성',
  used: '사용됨',
  revoked: '폐기',
};

/** 리프레시 토큰 회전 체인과 탈취(재사용) 감지 */
export default function TheftDemo({
  session,
  applySession,
  addLog,
}: {
  session: Session | null;
  applySession: (session: Session | null, reason?: string) => void;
  addLog: AddLogEntry;
}) {
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [chain, setChain] = useState<RefreshTokenRow[]>([]);
  const [stolenToken, setStolenToken] = useState<string | null>(null);
  const [attackerToken, setAttackerToken] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);

  const reloadChain = useCallback(async (targetFamilyId: string) => {
    const response = await authApi.family(targetFamilyId);
    if ('tokens' in response.body) setChain(response.body.tokens);
  }, []);

  // 로그인/회전 때마다 같은 패밀리의 체인을 다시 읽음
  useEffect(() => {
    const currentFamilyId = session?.refreshToken.familyId;
    if (!currentFamilyId) return;
    if (currentFamilyId !== familyId) {
      setFamilyId(currentFamilyId);
      setStolenToken(null);
      setAttackerToken(null);
      setVerdict(null);
    }
    void reloadChain(currentFamilyId);
  }, [session, familyId, reloadChain]);

  const steal = async () => {
    const response = await authApi.stealRefreshToken();
    addLog({
      actor: 'attacker',
      label: '(탈취) 리프레시 토큰 복사',
      credential: 'RT 쿠키',
      status: response.status,
      durationMs: response.durationMs,
    });
    if ('stolenRefreshTokenValue' in response.body) {
      setStolenToken(response.body.stolenRefreshTokenValue);
      setVerdict(
        '공격자가 현재 리프레시 토큰을 손에 넣었습니다. 이제 누가 먼저 쓰든, 같은 토큰이 두 번 쓰이는 순간 서버가 알아챕니다.',
      );
    }
  };

  const userRefresh = async () => {
    const response = await authApi.refresh(15);
    addLog({
      actor: 'user',
      label: 'POST /auth/refresh',
      credential: 'RT 쿠키',
      status: response.status,
      reason: errorReason(response.body),
      durationMs: response.durationMs,
    });
    if (isSession(response.body)) applySession(response.body);
    else {
      applySession(null, errorReason(response.body));
      setVerdict(
        `사용자 refresh 실패: ${REASON_KO[errorReason(response.body)] ?? errorReason(response.body)} → 사용자도 쫓겨남`,
      );
    }
    if (familyId) await reloadChain(familyId);
  };

  const attackerRefresh = async () => {
    const token = attackerToken ?? stolenToken;
    if (!token) return;
    const response = await authApi.refreshWithStolenToken(token);
    addLog({
      actor: 'attacker',
      label: 'POST /auth/refresh (훔친 토큰)',
      credential: shortToken(token),
      status: response.status,
      reason: errorReason(response.body),
      durationMs: response.durationMs,
    });
    if ('rotatedRefreshTokenValue' in response.body) {
      setAttackerToken(response.body.rotatedRefreshTokenValue);
      setVerdict(
        '공격자가 먼저 사용해 회전에 성공했습니다. 이제 사용자가 자기(옛) 토큰으로 refresh하면 재사용으로 감지됩니다.',
      );
    } else {
      setVerdict(
        `공격자 refresh 실패: ${REASON_KO[errorReason(response.body)] ?? errorReason(response.body)}`,
      );
    }
    if (familyId) await reloadChain(familyId);
  };

  return (
    <section className={styles.card}>
      <h2>③ 리프레시 토큰 회전 & 탈취 감지</h2>
      <p className={styles.muted}>
        refresh할 때마다 옛 토큰은 <b>사용됨</b>, 새 토큰이 같은 패밀리로 발급됩니다(회전). 이미
        사용된 토큰이 다시 오면 정상 사용자와 공격자 중 누군가는 훔친 토큰을 쓰고 있다는 뜻이므로,
        서버는 누가 누군지 묻지 않고 <b>패밀리 전체를 폐기</b>
        합니다. 그래서 둘 다 로그아웃됩니다.
      </p>
      <div className={styles.actions}>
        <button onClick={() => void steal()} disabled={!session}>
          1. 리프레시 토큰 탈취
        </button>
        <button onClick={() => void userRefresh()} disabled={!session}>
          사용자 refresh
        </button>
        <button onClick={() => void attackerRefresh()} disabled={!stolenToken}>
          공격자 refresh (훔친 토큰)
        </button>
        {familyId && (
          <button onClick={() => void reloadChain(familyId)} className={styles.ghost}>
            DB 다시 읽기
          </button>
        )}
      </div>
      {stolenToken && (
        <p className={styles.mono}>
          공격자 보유: {shortToken(attackerToken ?? stolenToken)}{' '}
          {attackerToken && '(공격자가 회전시킨 새 토큰)'}
        </p>
      )}
      {verdict && <p className={styles.verdict}>{verdict}</p>}
      {chain.length > 0 && (
        <div className={styles.chain}>
          <p className={styles.muted}>
            RefreshToken 테이블 — family {familyId?.slice(0, 8)} ({chain.length}행, tokenHash는
            숨김)
          </p>
          <table className={styles.dbTable}>
            <thead>
              <tr>
                <th>id</th>
                <th>parentId</th>
                <th>status</th>
                <th>사유</th>
                <th>createdAt</th>
                <th>usedAt</th>
              </tr>
            </thead>
            <tbody>
              {chain.map((token) => (
                <tr key={token.id} className={styles[`row_${token.status}`]}>
                  <td>{token.id.slice(0, 8)}</td>
                  <td>{token.parentId ? `↖ ${token.parentId.slice(0, 8)}` : '— (로그인)'}</td>
                  <td>
                    <span className={styles[`status_${token.status}`]}>
                      {STATUS_KO[token.status]}
                    </span>
                  </td>
                  <td>{token.revokedReason ?? ''}</td>
                  <td>{formatTime(token.createdAt)}</td>
                  <td>{token.usedAt ? formatTime(token.usedAt) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour12: false, fractionalSecondDigits: 3 });
