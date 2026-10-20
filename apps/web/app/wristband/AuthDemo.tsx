'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '../../lib/api';
import { createSingleFlight } from '../../lib/single-flight';
import { DevDetails } from '../components/molecules/DevDetails';
import { DevFlow } from '../components/molecules/DevFlow';
import { authApi, errorReason, isSession, REASON_KO, type Session } from './api';
import { WRISTBAND_DEV_FLOW } from './dev-flow';
import ConcurrencyRace from './ConcurrencyRace';
import JwtDecoder from './JwtDecoder';
import StorageComparison from './StorageComparison';
import styles from './auth.module.css';
import TheftDemo from './TheftDemo';
import type { AddLogEntry, RequestLogEntry } from './types';
import WristbandStory from './WristbandStory';

/** 화면에 그대로 안내하는 데모 계정 */
export const DEMO_ACCOUNT = { username: 'demo', password: 'demo1234' };

const MAX_LOG_ENTRIES = 14;
const AUTO_CALL_INTERVAL_MS = 4000;

let nextLogId = 0;

/**
 * 페이지 전체가 공유하는 쿠키 기반 refresh (single-flight).
 * 동시에 401이 여러 개 나거나 StrictMode로 마운트가 두 번 일어나도 /auth/refresh 요청은 하나.
 */
let refreshTtlSeconds = 15;
const refreshWithCookieOnce = createSingleFlight(() => authApi.refresh(refreshTtlSeconds));

export default function AuthDemo() {
  const [session, setSession] = useState<Session | null>(null);
  const [accessTokenTtlSeconds, setAccessTokenTtlSeconds] = useState(15);
  const [log, setLog] = useState<RequestLogEntry[]>([]);
  const [autoCall, setAutoCall] = useState(false);
  const [rotationCount, setRotationCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [restoreState, setRestoreState] = useState<'restoring' | 'restored' | 'none'>('restoring');
  const sessionRef = useRef<Session | null>(null);
  const tokenLabels = useRef(new Map<string, string>());

  const labelFor = useCallback((accessToken: string) => {
    let label = tokenLabels.current.get(accessToken);
    if (!label) {
      label = `AT#${tokenLabels.current.size + 1}`;
      tokenLabels.current.set(accessToken, label);
    }
    return label;
  }, []);

  const addLog: AddLogEntry = useCallback((entry) => {
    setLog((previous) =>
      [{ ...entry, id: ++nextLogId, at: Date.now() }, ...previous].slice(0, MAX_LOG_ENTRIES),
    );
  }, []);

  const applySession = useCallback((next: Session | null, reason?: string) => {
    sessionRef.current = next;
    setSession(next);
    if (!next) {
      setAutoCall(false);
      setMessage(reason ? `로그아웃됨: ${REASON_KO[reason] ?? reason}` : '로그아웃됨');
    } else setMessage(null);
  }, []);

  const loggedRefreshResults = useRef(new WeakSet<object>());
  /** 공유된 refresh 결과 하나당 로그 한 줄만 (여러 호출자가 같은 결과를 받아도 중복 기록 X) */
  const logRefreshOnce = useCallback(
    (result: ApiResult<unknown>, label: string, note?: string) => {
      if (loggedRefreshResults.current.has(result)) return;
      loggedRefreshResults.current.add(result);
      addLog({
        actor: 'user',
        label,
        credential: 'RT 쿠키',
        status: result.status,
        reason: errorReason(result.body),
        durationMs: result.durationMs,
        note,
      });
    },
    [addLog],
  );

  useEffect(() => {
    refreshTtlSeconds = accessTokenTtlSeconds;
  }, [accessTokenTtlSeconds]);

  const refreshSession = useCallback(async () => {
    const result = await refreshWithCookieOnce();
    logRefreshOnce(result, 'POST /auth/refresh', '회전: 새 AT + 새 RT');
    if (isSession(result.body)) {
      applySession(result.body);
      setRotationCount((count) => count + 1);
      return result.body;
    }
    applySession(null, errorReason(result.body));
    return null;
  }, [applySession, logRefreshOnce]);

  // 새로고침/첫 방문: 메모리의 액세스 토큰은 사라졌으므로 httpOnly 쿠키의 리프레시 토큰으로 조용히 복구.
  // StrictMode(dev)에서 effect가 두 번 실행돼도 refreshWithCookieOnce가 진행 중 요청을 공유하므로
  // 같은 리프레시 토큰으로 두 번 회전하지 않는다 (두 번 보내면 재사용 감지로 로그인이 폐기됨).
  useEffect(() => {
    let mounted = true;
    void refreshWithCookieOnce().then((result) => {
      if (!mounted) return;
      const restored = isSession(result.body);
      logRefreshOnce(
        result,
        '새로고침 → POST /auth/refresh',
        restored ? '쿠키의 리프레시 토큰으로 액세스 토큰 복구' : undefined,
      );
      if (isSession(result.body)) {
        applySession(result.body);
        setRestoreState('restored');
      } else {
        sessionRef.current = null;
        setSession(null);
        const reason = errorReason(result.body);
        setRestoreState('none');
        setMessage(
          reason === 'refresh_token_missing'
            ? '저장된 로그인이 없습니다 (리프레시 쿠키 없음) — 로그인하세요'
            : `로그인 복구 실패: ${REASON_KO[reason] ?? reason} — 다시 로그인하세요`,
        );
      }
    });
    return () => {
      mounted = false;
    };
  }, [applySession, logRefreshOnce]);

  /** GET /auth/me → 401(만료)이면 refresh 후 1번 재시도 */
  const callMe = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    const first = await authApi.me(current.accessToken);
    addLog({
      actor: 'user',
      label: 'GET /auth/me',
      credential: labelFor(current.accessToken),
      status: first.status,
      reason: errorReason(first.body),
      durationMs: first.durationMs,
    });
    if (first.status !== 401 || errorReason(first.body) !== 'access_token_expired') return;
    const refreshed = await refreshSession();
    if (!refreshed) return;
    const retry = await authApi.me(refreshed.accessToken);
    addLog({
      actor: 'user',
      label: 'GET /auth/me (재시도)',
      credential: labelFor(refreshed.accessToken),
      status: retry.status,
      reason: errorReason(retry.body),
      durationMs: retry.durationMs,
    });
  }, [addLog, labelFor, refreshSession]);

  useEffect(() => {
    if (!autoCall) return;
    void callMe();
    const intervalId = setInterval(() => void callMe(), AUTO_CALL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [autoCall, callMe]);

  const login = async (username: string, password: string) => {
    const result = await authApi.login(username, password, accessTokenTtlSeconds);
    addLog({
      actor: 'user',
      label: 'POST /auth/login',
      credential: username,
      status: result.status,
      reason: errorReason(result.body),
      durationMs: result.durationMs,
      note: isSession(result.body) ? 'AT 발급 + RT 쿠키 설정' : undefined,
    });
    if (isSession(result.body)) {
      setRotationCount(0);
      applySession(result.body);
    } else setMessage(REASON_KO[errorReason(result.body)] ?? `로그인 실패 (${result.status})`);
  };

  /** 이야기 버튼용: 로그인돼 있지 않으면 데모 계정으로 먼저 들어간다 */
  const ensureSession = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current;
    const result = await authApi.login(
      DEMO_ACCOUNT.username,
      DEMO_ACCOUNT.password,
      accessTokenTtlSeconds,
    );
    addLog({
      actor: 'user',
      label: 'POST /auth/login',
      credential: DEMO_ACCOUNT.username,
      status: result.status,
      reason: errorReason(result.body),
      durationMs: result.durationMs,
      note: isSession(result.body) ? 'AT 발급 + RT 쿠키 설정' : undefined,
    });
    if (!isSession(result.body)) return null;
    setRotationCount(0);
    applySession(result.body);
    return result.body;
  }, [accessTokenTtlSeconds, addLog, applySession]);

  const logout = async () => {
    const result = await authApi.logout();
    addLog({
      actor: 'user',
      label: 'POST /auth/logout',
      credential: 'RT 쿠키',
      status: result.status,
      durationMs: result.durationMs,
      note: `토큰 ${'revokedTokens' in result.body ? result.body.revokedTokens : 0}개 폐기`,
    });
    applySession(null);
  };

  return (
    <>
      <WristbandStory
        session={session}
        ensureSession={ensureSession}
        applySession={applySession}
        addLog={addLog}
        labelFor={labelFor}
        accessTokenTtlSeconds={accessTokenTtlSeconds}
        restoreState={restoreState}
      />
      <section style={{ maxWidth: 'var(--wide)', margin: '0 auto' }}>
        <DevDetails description="토큰 수명 타임라인과 로그인, 요청 기록, 동시 갱신 경주, 토큰 묶음(family) 표, JWT 디코더">
          <DevFlow content={WRISTBAND_DEV_FLOW} />
          <div className={styles.main}>
            <section className={styles.card}>
              <h2>① 토큰 수명 타임라인</h2>
              {restoreState === 'restoring' && !session ? (
                <p className={styles.muted}>쿠키의 리프레시 토큰으로 로그인 복구 중…</p>
              ) : session ? (
                <SessionBar
                  session={session}
                  rotationCount={rotationCount}
                  labelFor={labelFor}
                  autoCall={autoCall}
                  onToggleAutoCall={() => setAutoCall((value) => !value)}
                  onCallMe={() => void callMe()}
                  onLogout={() => void logout()}
                />
              ) : (
                <LoginForm
                  ttl={accessTokenTtlSeconds}
                  onTtlChange={setAccessTokenTtlSeconds}
                  onLogin={login}
                />
              )}
              {message && <p className={styles.warn}>{message}</p>}
              <RequestTimeline log={log} />
            </section>

            <ReloadExplainer restoreState={restoreState} />

            <ConcurrencyRace
              session={session}
              applySession={applySession}
              addLog={addLog}
              labelFor={labelFor}
              accessTokenTtlSeconds={accessTokenTtlSeconds}
            />
            <TheftDemo session={session} applySession={applySession} addLog={addLog} />
            <StorageComparison />
            <JwtDecoder accessToken={session?.accessToken ?? null} />
          </div>
        </DevDetails>
      </section>
    </>
  );
}

function LoginForm({
  ttl,
  onTtlChange,
  onLogin,
}: {
  ttl: number;
  onTtlChange: (seconds: number) => void;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('demo1234');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={styles.loginForm}
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        setBusy(true);
        void onLogin(username, password).finally(() => setBusy(false));
      }}
    >
      <input
        value={username}
        onChange={(changeEvent) => setUsername(changeEvent.target.value)}
        aria-label="아이디"
        autoComplete="username"
      />
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(changeEvent) => setPassword(changeEvent.target.value)}
        aria-label="비밀번호"
      />
      <label>
        액세스 토큰 수명{' '}
        <select
          value={ttl}
          onChange={(changeEvent) => onTtlChange(Number(changeEvent.target.value))}
        >
          {[10, 15, 30, 60].map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds}초
            </option>
          ))}
        </select>
      </label>
      <button className={styles.primary} disabled={busy}>
        로그인
      </button>
      <span className={styles.muted}>데모 계정: demo / demo1234, alice / alice1234</span>
    </form>
  );
}

/** 토큰 상태 + 만료 카운트다운. 자기 자신만 250ms마다 리렌더 */
const SessionBar = memo(function SessionBar({
  session,
  rotationCount,
  labelFor,
  autoCall,
  onToggleAutoCall,
  onCallMe,
  onLogout,
}: {
  session: Session;
  rotationCount: number;
  labelFor: (accessToken: string) => string;
  autoCall: boolean;
  onToggleAutoCall: () => void;
  onCallMe: () => void;
  onLogout: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(intervalId);
  }, []);
  const expiresAtMs = new Date(session.accessTokenExpiresAt).getTime();
  const issuedAtMs = new Date(session.refreshToken.createdAt).getTime();
  const totalMs = Math.max(1, expiresAtMs - issuedAtMs);
  const remainingMs = Math.max(0, expiresAtMs - nowMs);
  const expired = remainingMs === 0;
  return (
    <div className={styles.sessionGrid}>
      <div className={styles.tokenCard}>
        <div className={styles.tokenHead}>
          <b>액세스 토큰 {labelFor(session.accessToken)}</b>
          <span className={expired ? styles.badgeBad : styles.badgeOk}>
            {expired ? '만료됨' : `${(remainingMs / 1000).toFixed(1)}초 남음`}
          </span>
        </div>
        <div className={styles.countdown}>
          <span
            className={styles.countdownFill}
            style={{
              transform: `scaleX(${remainingMs / totalMs})`,
              background: expired ? '#A3321F' : '#44633D',
            }}
          />
        </div>
        <p className={styles.muted}>
          메모리(JS 변수)에만 보관 · 요청마다 Authorization: Bearer 헤더로 전송
        </p>
      </div>
      <div className={styles.tokenCard}>
        <div className={styles.tokenHead}>
          <b>리프레시 토큰</b>
          <span className={styles.badgeOk}>회전 {rotationCount}회</span>
        </div>
        <p className={styles.mono}>
          id {session.refreshToken.id.slice(0, 8)} · family{' '}
          {session.refreshToken.familyId.slice(0, 8)}
        </p>
        <p className={styles.muted}>
          httpOnly 쿠키 (JS로 읽을 수 없음) · /auth 경로에만 전송 · DB엔 해시만 저장
        </p>
      </div>
      <div className={styles.actions}>
        <span>
          {session.user.displayName} ({session.user.username})
        </span>
        <button onClick={onCallMe}>GET /auth/me 호출</button>
        <button className={autoCall ? styles.primary : ''} onClick={onToggleAutoCall}>
          {autoCall ? '자동 호출 중 (4초마다)' : '자동 호출'}
        </button>
        <button onClick={onLogout}>로그아웃</button>
      </div>
    </div>
  );
});

/** 요청 로그: 최신이 위, 새 줄은 슬라이드 인 (최대 14줄) */
const RequestTimeline = memo(function RequestTimeline({ log }: { log: RequestLogEntry[] }) {
  if (log.length === 0) return <p className={styles.muted}>로그인하면 요청이 여기에 쌓입니다.</p>;
  return (
    <ol className={styles.timeline}>
      {log.map((entry) => (
        <li
          key={entry.id}
          className={`${styles.timelineRow} ${entry.actor === 'attacker' ? styles.attackerRow : ''}`}
        >
          <span className={styles.muted}>
            {new Date(entry.at).toLocaleTimeString('ko-KR', { hour12: false })}
          </span>
          <span>{entry.actor === 'attacker' ? '' : ''}</span>
          <span className={styles.mono}>{entry.label}</span>
          <span className={styles.credential}>{entry.credential}</span>
          <span className={entry.status < 300 ? styles.badgeOk : styles.badgeBad}>
            {entry.status}
          </span>
          <span className={styles.muted}>
            {entry.reason ? (REASON_KO[entry.reason] ?? entry.reason) : (entry.note ?? '')} ·{' '}
            {Math.round(entry.durationMs)}
            ms
          </span>
        </li>
      ))}
    </ol>
  );
});

/** 왜 액세스 토큰은 메모리에 두는지, 새로고침 후 어떻게 복구되는지 */
function ReloadExplainer({ restoreState }: { restoreState: 'restoring' | 'restored' | 'none' }) {
  return (
    <section className={styles.card}>
      <h2>새로고침하면 액세스 토큰은 사라지는데, 왜 로그인은 유지될까?</h2>
      <ol className={styles.steps}>
        <li>
          액세스 토큰은 <b>메모리(JS 변수)</b>에만 둡니다. localStorage에 두면 XSS 스크립트가 바로
          훔쳐 갈 수 있기 때문입니다. 대신 새로고침하면 사라집니다.
        </li>
        <li>
          리프레시 토큰은 <b>httpOnly 쿠키</b>라 JS는 못 읽지만, 브라우저가 <code>/auth</code>{' '}
          요청에 자동으로 붙여 보냅니다 (
          <code>
            fetch(…, {'{'} credentials: &apos;include&apos; {'}'})
          </code>
          ).
        </li>
        <li>
          그래서 페이지가 열리면 바로 <code>POST /auth/refresh</code>를 한 번 호출해 새 액세스
          토큰을 받습니다 (silent refresh). 이때 리프레시 토큰도 회전됩니다.
        </li>
        <li>
          React StrictMode(dev)는 effect를 두 번 실행합니다. 같은 쿠키로 refresh를 두 번 보내면 두
          번째가 <b>재사용으로 감지돼 로그인이 폐기</b>되므로, 진행 중인 요청을
          공유(single-flight)해 한 번만 보냅니다.
        </li>
      </ol>
      <p className={styles.muted}>
        localhost:3000(웹)과 localhost:4000(API)은 포트만 다른 <b>같은 사이트</b>라 SameSite=Lax
        쿠키가 전송되고, API는 CORS에서 <code>credentials: true</code>로 http://localhost:3000만
        허용합니다. 이번 페이지 로드:{' '}
        <b className={restoreState === 'restored' ? styles.okText : ''}>
          {restoreState === 'restoring'
            ? '복구 중…'
            : restoreState === 'restored'
              ? '쿠키로 복구 성공'
              : '복구할 로그인 없음'}
        </b>
      </p>
    </section>
  );
}
