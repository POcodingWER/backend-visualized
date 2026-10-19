'use client';

import { memo, useMemo, useState } from 'react';
import { API_URL } from '../../lib/api';
import styles from './coupon.module.css';

import { Breakdown, DbChart, DbTables, RequestLog, StrategyDetail, TruthCheck } from './DbPanels';
import {
  DEFAULT_USERS,
  QUANTITY,
  STRATEGY_INFO,
  STRATEGY_ORDER,
  replayStateAt,
  runSimulation,
} from './simulation';
import type { DbState, Result, Strategy } from './types';
import { useReplay } from '../components/useReplay';

const MAX_DOTS = 36;

/**
 * "개발자용 자세히" 안의 실험실: 전략 선택, 사용자 수, 실측 재생, DB 패널 전부.
 * results는 장(chapter) 전체가 공유한다 (처음엔 지난 실측 기록, 실행하면 최신 결과로 교체).
 */
export default function StrategyLab({
  results,
  onResults,
}: {
  results: Partial<Record<Strategy, Result>>;
  onResults: (newResults: Result[]) => void;
}) {
  const [strategy, setStrategy] = useState<Strategy>('none');
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dbState, setDbState] = useState<DbState | null>(null);
  const replay = results[strategy] ?? null;
  const { elapsedMs, replayMs, isDone: done, play } = useReplay(replay);

  const loadState = async (name: string) => {
    try {
      const response = await fetch(
        `${API_URL}/coupons/${encodeURIComponent(name)}/state?limit=10`,
        {
          cache: 'no-store',
        },
      );
      setDbState(response.ok ? ((await response.json()) as DbState) : null);
    } catch {
      setDbState(null);
    }
  };

  const run = async (runAllStrategies: boolean) => {
    setBusy(
      runAllStrategies
        ? '4개 전략을 순서대로 실행 중… (낙관적 락은 수 초~20초 이상 걸릴 수 있어요)'
        : `${STRATEGY_INFO[strategy].name} 실행 중…`,
    );
    setError(null);
    try {
      const simulationResults = await runSimulation({
        users,
        quantity: QUANTITY,
        ...(runAllStrategies ? {} : { strategy }),
      });
      onResults(simulationResults);
      play();
      const replayed = simulationResults.find((simulation) => simulation.strategy === strategy);
      if (replayed) void loadState(replayed.couponName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const selectStrategy = (selected: Strategy) => {
    setStrategy(selected);
    setDbState(null);
    if (results[selected]) play();
  };

  const replayState = useMemo(
    () => (replay ? replayStateAt(replay.requests, elapsedMs) : null),
    [replay, elapsedMs],
  );
  const info = STRATEGY_INFO[strategy];

  return (
    <div className={styles.main}>
      <section className={styles.tabs}>
        {STRATEGY_ORDER.map((strategyKey) => (
          <button
            key={strategyKey}
            className={strategyKey === strategy ? styles.tabOn : styles.tab}
            style={{ '--c': STRATEGY_INFO[strategyKey].color } as React.CSSProperties}
            onClick={() => selectStrategy(strategyKey)}
            disabled={!!busy}
          >
            <span className={styles.swatch} />
            {STRATEGY_INFO[strategyKey].name}
            <small>{strategyKey}</small>
          </button>
        ))}
      </section>

      <section className={styles.explain} style={{ '--c': info.color } as React.CSSProperties}>
        <p>
          <b>어떻게:</b> {info.how}
        </p>
        <p>
          <b className={styles.okText}>장점:</b> {info.pro} <b className={styles.errText}>단점:</b>{' '}
          {info.con}
        </p>
      </section>

      <section className={styles.controls}>
        <label>
          동시 사용자{' '}
          <select
            value={users}
            onChange={(changeEvent) => setUsers(Number(changeEvent.target.value))}
            disabled={!!busy}
          >
            {[200, 500, 1000].map((userCount) => (
              <option key={userCount} value={userCount}>
                {userCount}명
              </option>
            ))}
          </select>
        </label>
        <button className={styles.primary} onClick={() => void run(false)} disabled={!!busy}>
          {info.name}로 실행
        </button>
        <button onClick={() => void run(true)} disabled={!!busy}>
          4개 전략 모두 비교
        </button>
        {replay && (
          <button onClick={play} disabled={!!busy}>
            다시 재생
          </button>
        )}
        {busy && <span className={styles.busy}>{busy}</span>}
        {error && <span className={styles.errText}>{error}</span>}
      </section>

      <section className={styles.stage}>
        {replay && replayState ? (
          <>
            <div className={styles.meta}>
              {replay.users}명 / {replay.quantity}장 · 실측 {(replay.durationMs / 1000).toFixed(2)}
              초 → {(replayMs / 1000).toFixed(1)}초로 재생 · 경과{' '}
              <b>{(elapsedMs / 1000).toFixed(2)}s</b>
            </div>
            <div className={styles.arena}>
              <Crowd
                strategy={replay.strategy}
                inflight={replayState.inflight}
                recentRetry={replayState.recentRetry}
              />
              <Grid
                quantity={replay.quantity}
                issued={replayState.issued}
                over={replayState.over}
                color={STRATEGY_INFO[replay.strategy].color}
              />
            </div>
            <div className={styles.counters}>
              <Counter label="발급" value={replayState.issued} />
              <Counter label="초과 발급" value={replayState.over} bad={replayState.over > 0} />
              <Counter label="거절(매진·재시도 초과)" value={replayState.rejected} />
              <Counter label="대기/진행 중 요청" value={replayState.inflight} />
              <Counter label="재시도" value={replayState.retries} />
              {done && (
                <Counter
                  label="DB 카운터 issuedCount"
                  value={replay.final.issuedCount}
                  bad={replay.final.counterMismatch}
                  hint={
                    replay.final.counterMismatch
                      ? `실제 행 ${replay.final.issueRows}개와 불일치 (lost update)`
                      : undefined
                  }
                />
              )}
            </div>
          </>
        ) : (
          <p className={styles.muted}>
            {busy ? '서버에서 실행 중…' : '이 전략으로 실행해 보세요.'}
          </p>
        )}
      </section>

      {replay && (
        <>
          <section className={styles.dbGrid}>
            <DbChart result={replay} elapsedMs={elapsedMs} />
            <DbTables result={replay} elapsedMs={elapsedMs} />
            <Breakdown result={replay} elapsedMs={elapsedMs} />
            <StrategyDetail result={replay} />
          </section>
          <TruthCheck dbState={dbState} onReload={() => void loadState(replay.couponName)} />
          <RequestLog key={`${replay.strategy}-${replay.durationMs}`} result={replay} />
        </>
      )}

      <Compare results={results} />
    </div>
  );
}

const Counter = memo(function Counter({
  label,
  value,
  bad,
  hint,
}: {
  label: string;
  value: number;
  bad?: boolean;
  hint?: string;
}) {
  return (
    <div className={`${styles.counter} ${bad ? styles.counterBad : ''}`}>
      <span>{label}</span>
      <b>{value.toLocaleString()}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
});

/** 전략별 "요청이 몰리는 모습". 렌더 요소는 MAX_DOTS로 상한, 움직임은 CSS transform 애니메이션 */
const Crowd = memo(function Crowd({
  strategy,
  inflight,
  recentRetry,
}: {
  strategy: Strategy;
  inflight: number;
  recentRetry: number;
}) {
  const dots = Math.min(inflight, MAX_DOTS);
  const more = inflight - dots;
  if (strategy === 'pessimistic') {
    return (
      <div className={styles.crowd}>
        <p className={styles.crowdTitle}>락 대기열 — 한 번에 한 명만 들어감</p>
        <div className={styles.queueLine}>
          {Array.from({ length: Math.max(0, dots - 1) }, (_, i) => (
            <i key={i} className={styles.qDot} />
          ))}
          {more > 0 && <span className={styles.more}>+{more}</span>}
          {inflight > 0 && <span className={styles.lockHolder}></span>}
          <span className={styles.door} />
        </div>
      </div>
    );
  }
  if (strategy === 'optimistic') {
    const bouncing = Math.min(recentRetry, MAX_DOTS);
    return (
      <div className={styles.crowd}>
        <p className={styles.crowdTitle}>version 충돌 → 튕겨나와 재시도</p>
        <div className={styles.bounceArea}>
          {Array.from({ length: bouncing }, (_, i) => (
            <i
              key={i}
              className={styles.bounceDot}
              style={{ left: `${(i * 37) % 92}%`, animationDelay: `${(i * 113) % 600}ms` }}
            />
          ))}
          {recentRetry - bouncing > 0 && (
            <span className={styles.more}>+{recentRetry - bouncing}</span>
          )}
        </div>
        <p className={styles.muted}>재시도 중 요청 {recentRetry}개</p>
      </div>
    );
  }
  if (strategy === 'atomic') {
    return (
      <div className={styles.crowd}>
        <p className={styles.crowdTitle}>조건부 UPDATE 게이트 — 판단과 증가가 한 문장</p>
        <div className={styles.gateArea}>
          {Array.from({ length: Math.min(dots, 12) }, (_, i) => (
            <i
              key={i}
              className={styles.rushDot}
              style={{ top: `${10 + ((i * 29) % 80)}%`, animationDelay: `${(i * 97) % 500}ms` }}
            />
          ))}
          <span className={styles.gate}>issued &lt; total ?</span>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.crowd}>
      <p className={styles.crowdTitle}>모두가 동시에 &quot;아직 남았다&quot;를 읽고 통과</p>
      <div className={styles.gateArea}>
        {Array.from({ length: dots }, (_, i) => (
          <i
            key={i}
            className={`${styles.rushDot} ${styles.rushBad}`}
            style={{ top: `${5 + ((i * 23) % 90)}%`, animationDelay: `${(i * 71) % 500}ms` }}
          />
        ))}
        {more > 0 && <span className={styles.more}>+{more}</span>}
      </div>
    </div>
  );
});

/** 쿠폰 슬롯 그리드: quantity칸 + 초과분은 빨간 칸으로 덧붙임 (최대 400칸 표시) */
const Grid = memo(function Grid({
  quantity,
  issued,
  over,
  color,
}: {
  quantity: number;
  issued: number;
  over: number;
  color: string;
}) {
  const extra = Math.min(over, 400);
  return (
    <div className={styles.gridWrap}>
      <p className={styles.crowdTitle}>
        쿠폰 {quantity}장 {over > 0 && <span className={styles.errText}>+ 초과 {over}장</span>}
      </p>
      <div className={styles.grid}>
        {Array.from({ length: quantity }, (_, i) => (
          <i
            key={i}
            className={i < issued - over ? styles.slotOn : styles.slot}
            style={{ '--c': color } as React.CSSProperties}
          />
        ))}
        {Array.from({ length: extra }, (_, i) => (
          <i key={`x${i}`} className={styles.slotOver} />
        ))}
      </div>
    </div>
  );
});

const Compare = memo(function Compare({ results }: { results: Partial<Record<Strategy, Result>> }) {
  const completedResults = STRATEGY_ORDER.map((strategyKey) => results[strategyKey]).filter(
    (result): result is Result => !!result,
  );
  if (completedResults.length === 0) return null;
  const slowestDurationMs = Math.max(...completedResults.map((result) => result.durationMs));
  return (
    <section className={styles.card}>
      <h2>전략 비교 (같은 조건의 실측 결과)</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>전략</th>
            <th>실제 발급</th>
            <th>초과 발급</th>
            <th>카운터</th>
            <th>재시도</th>
            <th>실패</th>
            <th style={{ width: '35%' }}>소요 시간</th>
          </tr>
        </thead>
        <tbody>
          {completedResults.map((result) => (
            <tr key={result.strategy}>
              <td>
                <b style={{ color: STRATEGY_INFO[result.strategy].color }}>
                  {STRATEGY_INFO[result.strategy].name}
                </b>
                <small className={styles.muted}>
                  {' '}
                  {result.users}명/{result.quantity}장
                </small>
              </td>
              <td>{result.final.issueRows}</td>
              <td className={result.final.oversold > 0 ? styles.errText : styles.okText}>
                {result.final.oversold}
              </td>
              <td className={result.final.counterMismatch ? styles.errText : ''}>
                {result.final.issuedCount}
              </td>
              <td>{result.summary.totalRetries.toLocaleString()}</td>
              <td
                className={
                  result.summary.retry_exhausted + result.summary.error > 0 ? styles.errText : ''
                }
              >
                {result.summary.retry_exhausted + result.summary.error}
              </td>
              <td>
                <span className={styles.barWrap}>
                  <span
                    className={styles.bar}
                    style={{
                      width: `${(result.durationMs / slowestDurationMs) * 100}%`,
                      background: STRATEGY_INFO[result.strategy].color,
                    }}
                  />
                </span>
                {(result.durationMs / 1000).toFixed(2)}s
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.muted}>
        참고: docs/benchmarks/stage3-coupon.md 실측(500명 vs 100장, M1 Pro 로컬) — none 400장 초과
        발급, pessimistic ~1.7s, optimistic 재시도 ~14,000회·60장만 발급·~24s, atomic ~0.4s.
      </p>
    </section>
  );
});
