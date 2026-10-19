'use client';

import { useState } from 'react';
import { authApi, errorReason, isSession, REASON_KO, type Session } from '../../lib/auth-api';
import { createSingleFlight } from '../../lib/single-flight';
import styles from './auth.module.css';
import type { AddLogEntry } from './types';

const PARALLEL_REQUESTS = 5;
export type RefreshMode = 'naive' | 'single-flight';

interface LaneStep {
  label: string;
  status: number;
  reason?: string;
  /** 실행 시작 기준 ms */
  atMs: number;
}

export interface RaceResult {
  mode: RefreshMode;
  lanes: LaneStep[][];
  refreshCalls: number;
  totalMs: number;
  loggedOut: boolean;
}

export type RaceOutcome = {
  result: RaceResult;
  latestSession: Session | null;
  failureReason?: string;
};

/** 만료된 액세스 토큰으로 요청 5개를 동시에 보내고, mode에 따라 refresh를 각자/하나만 호출 (실제 API) */
export async function runRefreshRace(
  mode: RefreshMode,
  accessTokenTtlSeconds: number,
  addLog: AddLogEntry,
): Promise<RaceOutcome | { error: string }> {
  const expired = await authApi.expiredAccessToken();
  if (!('accessToken' in expired.body))
    return { error: '먼저 로그인하세요 (활성 리프레시 토큰 필요)' };
  const expiredAccessToken = expired.body.accessToken;
  const startedAt = performance.now();
  const elapsed = () => performance.now() - startedAt;
  let refreshCalls = 0;
  let latestSession: Session | null = null;
  let failureReason: string | undefined;

  const callRefresh = async () => {
    refreshCalls++;
    const response = await authApi.refresh(accessTokenTtlSeconds);
    addLog({
      actor: 'user',
      label: `POST /auth/refresh (${mode})`,
      credential: 'RT 쿠키',
      status: response.status,
      reason: errorReason(response.body),
      durationMs: response.durationMs,
    });
    return response;
  };
  // single-flight: 5개 요청이 refresh 하나를 공유
  const sharedRefresh = createSingleFlight(callRefresh);

  const lanes = await Promise.all(
    Array.from({ length: PARALLEL_REQUESTS }, async () => {
      const steps: LaneStep[] = [];
      const first = await authApi.me(expiredAccessToken);
      steps.push({
        label: 'me',
        status: first.status,
        reason: errorReason(first.body),
        atMs: elapsed(),
      });
      const refreshResponse = mode === 'naive' ? await callRefresh() : await sharedRefresh();
      steps.push({
        label: 'refresh',
        status: refreshResponse.status,
        reason: errorReason(refreshResponse.body),
        atMs: elapsed(),
      });
      if (!isSession(refreshResponse.body)) {
        failureReason = errorReason(refreshResponse.body);
        return steps;
      }
      latestSession = refreshResponse.body;
      const retry = await authApi.me(refreshResponse.body.accessToken);
      steps.push({
        label: '재시도',
        status: retry.status,
        reason: errorReason(retry.body),
        atMs: elapsed(),
      });
      return steps;
    }),
  );
  // naive: 첫 refresh가 회전한 뒤 나머지가 옛 토큰을 제출 → 재사용 감지 → 패밀리 폐기 → 로그아웃
  const loggedOut = failureReason !== undefined;
  return {
    result: { mode, lanes, refreshCalls, totalMs: elapsed(), loggedOut },
    latestSession,
    failureReason,
  };
}

export function applyRaceOutcome(
  outcome: RaceOutcome,
  applySession: (session: Session | null, reason?: string) => void,
  labelFor: (accessToken: string) => string,
) {
  if (outcome.result.loggedOut) applySession(null, outcome.failureReason);
  else if (outcome.latestSession) {
    labelFor(outcome.latestSession.accessToken);
    applySession(outcome.latestSession);
  }
}

/** 만료된 액세스 토큰으로 동시에 요청 5개를 보냈을 때, refresh를 어떻게 부르느냐에 따른 차이 */
export default function ConcurrencyRace({
  session,
  applySession,
  addLog,
  labelFor,
  accessTokenTtlSeconds,
}: {
  session: Session | null;
  applySession: (session: Session | null, reason?: string) => void;
  addLog: AddLogEntry;
  labelFor: (accessToken: string) => string;
  accessTokenTtlSeconds: number;
}) {
  const [mode, setMode] = useState<RefreshMode>('single-flight');
  const [result, setResult] = useState<RaceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await runRefreshRace(mode, accessTokenTtlSeconds, addLog);
      if ('error' in outcome) {
        setError(outcome.error);
        return;
      }
      applyRaceOutcome(outcome, applySession, labelFor);
      setResult(outcome.result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>② 동시 요청 문제: 만료된 토큰으로 요청 {PARALLEL_REQUESTS}개가 동시에 나가면?</h2>
        <div className={styles.toggle}>
          {(['naive', 'single-flight'] as RefreshMode[]).map((option) => (
            <button
              key={option}
              className={mode === option ? styles.primary : ''}
              onClick={() => setMode(option)}
              disabled={busy}
            >
              {option === 'naive' ? '각자 refresh (naive)' : '하나만 refresh (single-flight)'}
            </button>
          ))}
          <button className={styles.primary} onClick={() => void run()} disabled={busy || !session}>
            {busy ? '실행 중…' : '실행'}
          </button>
        </div>
      </div>
      <p className={styles.muted}>
        {mode === 'naive'
          ? '요청마다 401을 받으면 각자 refresh를 호출합니다. 5개가 같은 리프레시 쿠키를 들고 가므로, 첫 번째가 회전시킨 뒤 나머지는 "이미 사용된 토큰"을 낸 셈 → 서버는 탈취로 판단해 로그인 전체를 폐기합니다.'
          : '진행 중인 refresh Promise를 공유합니다. refresh는 딱 1번, 나머지 요청은 그 결과(새 액세스 토큰)를 기다렸다가 재시도합니다.'}
        {!session && ' (먼저 ①에서 로그인하세요)'}
      </p>
      {error && <p className={styles.warn}>{error}</p>}
      {result && <RaceView result={result} />}
    </section>
  );
}

function RaceView({ result }: { result: RaceResult }) {
  return (
    <div className={styles.race}>
      {result.lanes.map((steps, laneIndex) => (
        <div key={laneIndex} className={styles.raceLane}>
          <span className={styles.raceLabel}>요청 {laneIndex + 1}</span>
          <div className={styles.raceTrack}>
            {steps.map((step, stepIndex) => (
              <span
                key={stepIndex}
                className={`${styles.raceStep} ${step.status < 300 ? styles.stepOk : styles.stepBad}`}
                style={{
                  left: `${(step.atMs / Math.max(1, result.totalMs)) * 88}%`,
                  animationDelay: `${stepIndex * 250 + laneIndex * 40}ms`,
                }}
                title={step.reason ? (REASON_KO[step.reason] ?? step.reason) : undefined}
              >
                {step.label} {step.status}
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className={styles.raceSummary}>
        <span>
          refresh 호출{' '}
          <b className={result.refreshCalls > 1 ? styles.badText : styles.okText}>
            {result.refreshCalls}번
          </b>
        </span>
        <span>소요 {Math.round(result.totalMs)}ms</span>
        <span className={result.loggedOut ? styles.badText : styles.okText}>
          {result.loggedOut
            ? '재사용 감지로 로그인 전체 폐기 → 로그아웃'
            : '5개 요청 모두 재시도 성공, 로그인 유지'}
        </span>
      </div>
    </div>
  );
}
