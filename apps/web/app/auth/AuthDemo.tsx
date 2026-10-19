'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { authApi, errorReason, isSession, REASON_KO, type Session } from '../../lib/auth-api';
import { createSingleFlight } from '../../lib/single-flight';
import ConcurrencyRace from './ConcurrencyRace';
import JwtDecoder from './JwtDecoder';
import StorageComparison from './StorageComparison';
import styles from './auth.module.css';
import TheftDemo from './TheftDemo';
import type { AddLogEntry, RequestLogEntry } from './types';

const MAX_LOG_ENTRIES = 14;
const AUTO_CALL_INTERVAL_MS = 4000;

let nextLogId = 0;

export default function AuthDemo() {
  const [session, setSession] = useState<Session | null>(null);
  const [accessTokenTtlSeconds, setAccessTokenTtlSeconds] = useState(15);
  const [log, setLog] = useState<RequestLogEntry[]>([]);
  const [autoCall, setAutoCall] = useState(false);
  const [rotationCount, setRotationCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
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

  // 평소 흐름의 갱신은 single-flight (동시에 여러 곳에서 401이 나도 refresh는 한 번)
  const refreshOnce = useRef(
    createSingleFlight(async () => {
      const result = await authApi.refresh(ttlRef.current);
      addLogRef.current({
        actor: 'user',
        label: 'POST /auth/refresh',
        credential: 'RT 쿠키',
        status: result.status,
        reason: errorReason(result.body),
        durationMs: result.durationMs,
        note: isSession(result.body) ? '회전: 새 AT + 새 RT' : undefined,
      });
      if (!isSession(result.body)) throw new Error(errorReason(result.body) || 'refresh_failed');
      return result.body;
    }),
  );
  const ttlRef = useRef(accessTokenTtlSeconds);
  ttlRef.current = accessTokenTtlSeconds;
  const addLogRef = useRef(addLog);
  addLogRef.current = addLog;

  const refreshSession = useCallback(async () => {
    try {
      const next = await refreshOnce.current();
      applySession(next);
      setRotationCount((count) => count + 1);
      return next;
    } catch (error) {
      applySession(null, error instanceof Error ? error.message : undefined);
      return null;
    }
  }, [applySession]);

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
    <main className={styles.main}>
      <header>
        <p className={styles.kicker}>Stage 3 · 인증</p>
        <h1>액세스 토큰은 짧게, 리프레시 토큰은 안전하게</h1>
        <p className={styles.lead}>
          액세스 토큰(JWT)은 API마다 들고 다니는 <b>짧은 수명</b>의 출입증, 리프레시 토큰은 출입증을
          다시 발급받는 <b>긴 수명</b>의 열쇠입니다. 아래는 실제 NestJS API와 MySQL에 대해
          동작합니다.
        </p>
      </header>

      <section className={styles.card}>
        <h2>① 토큰 수명 타임라인</h2>
        {session ? (
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
    </main>
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
      />
      <input
        type="password"
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
          <b>🎫 액세스 토큰 {labelFor(session.accessToken)}</b>
          <span className={expired ? styles.badgeBad : styles.badgeOk}>
            {expired ? '만료됨' : `${(remainingMs / 1000).toFixed(1)}초 남음`}
          </span>
        </div>
        <div className={styles.countdown}>
          <span
            className={styles.countdownFill}
            style={{
              transform: `scaleX(${remainingMs / totalMs})`,
              background: expired ? '#fb7185' : '#34d399',
            }}
          />
        </div>
        <p className={styles.muted}>
          메모리(JS 변수)에만 보관 · 요청마다 Authorization: Bearer 헤더로 전송
        </p>
      </div>
      <div className={styles.tokenCard}>
        <div className={styles.tokenHead}>
          <b>🔑 리프레시 토큰</b>
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
          👤 {session.user.displayName} ({session.user.username})
        </span>
        <button onClick={onCallMe}>GET /auth/me 호출</button>
        <button className={autoCall ? styles.primary : ''} onClick={onToggleAutoCall}>
          {autoCall ? '⏸ 자동 호출 중 (4초마다)' : '▶ 자동 호출'}
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
          <span>{entry.actor === 'attacker' ? '😈' : '🙂'}</span>
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
