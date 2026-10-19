'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../../lib/api';
import styles from './coupon.module.css';

import { Breakdown, DbChart, DbTables, RequestLog, StrategyDetail, TruthCheck } from './DbPanels';
import type { DbState, Result, RequestTrace, Strategy } from './types';

const QUANTITY = 100;
/** 화면 갱신 주기 (매 프레임 setState 하지 않음) */
const TICK_MS = 100;
const MAX_DOTS = 36;

const INFO: Record<
  Strategy,
  { name: string; color: string; how: string; pro: string; con: string }
> = {
  none: {
    name: '제어 없음',
    color: '#fb7185',
    how: '남은 수량을 읽고 → 남았으면 발급하고 → 카운터를 (읽은 값 + 1)로 저장합니다.',
    pro: '가장 단순한 코드.',
    con: '여러 요청이 동시에 "아직 남았다"를 읽고 모두 통과 → 초과 발급. 카운터도 서로 덮어써서(lost update) 실제 발급 수와 어긋납니다.',
  },
  pessimistic: {
    name: '비관적 락',
    color: '#facc15',
    how: '트랜잭션에서 SELECT … FOR UPDATE로 쿠폰 행을 잠그고, 락을 잡은 요청만 확인·발급합니다. 나머지는 줄을 서서 기다립니다.',
    pro: '정확함. 충돌이 잦아도 재시도 없이 순서대로 처리.',
    con: '모두가 한 줄로 서므로 처리량이 락 하나에 묶이고, 대기 중인 트랜잭션이 DB 커넥션을 붙잡습니다.',
  },
  optimistic: {
    name: '낙관적 락',
    color: '#22d3ee',
    how: 'version을 같이 읽고, UPDATE … WHERE version = 읽은값 으로 갱신합니다. 누가 먼저 바꿨으면 0행 → 다시 읽고 재시도.',
    pro: '락을 잡지 않아 충돌이 드문 데이터에선 가볍고 빠름.',
    con: '한 행에 수백 명이 몰리면 대부분 충돌 → 재시도 폭증. 재시도 한도(30회)를 넘기면 쿠폰이 남아도 실패합니다.',
  },
  atomic: {
    name: '원자적 UPDATE',
    color: '#34d399',
    how: 'UPDATE … SET issued = issued + 1 WHERE issued < total 한 문장으로 "확인 + 증가"를 DB가 한 번에 처리합니다.',
    pro: '정확하고 가장 빠름. 코드도 단순.',
    con: '조건이 한 문장으로 표현될 때만 가능. 복잡한 검증(1인 1매 등)은 unique 제약 등과 함께 써야 합니다.',
  },
};
const ORDER: Strategy[] = ['none', 'pessimistic', 'optimistic', 'atomic'];

/** 실제 timeline을 진행 시간 p(ms, 실측 기준)에서 잘라 본 상태 */
function replayStateAt(requests: RequestTrace[], elapsedMs: number) {
  let issued = 0,
    over = 0,
    rejected = 0,
    inflight = 0,
    retries = 0,
    recentRetry = 0;
  for (const request of requests) {
    if (request.startedAtMs > elapsedMs) continue;
    if (request.finishedAtMs <= elapsedMs) {
      if (request.success) {
        issued++;
        if (request.oversold) over++;
      } else rejected++;
      retries += request.retries;
    } else {
      inflight++;
      // 진행 중 요청의 재시도는 경과 비율만큼 진행됐다고 근사
      retries +=
        (request.retries * (elapsedMs - request.startedAtMs)) / Math.max(1, request.durationMs);
      recentRetry += request.retries > 0 ? 1 : 0;
    }
  }
  return { issued, over, rejected, inflight, retries: Math.round(retries), recentRetry };
}

export default function CouponRace() {
  const [strategy, setStrategy] = useState<Strategy>('none');
  const [users, setUsers] = useState(500);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<Strategy, Result>>>({});
  const [replay, setReplay] = useState<Result | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [dbState, setDbState] = useState<DbState | null>(null);
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
  const animationFrameId = useRef<number | null>(null);

  // 재생: 실측 duration을 2~6초로 스케일, rAF로 돌되 setState는 TICK_MS마다
  const replayMs = replay ? Math.min(6000, Math.max(2500, replay.durationMs)) : 0;
  useEffect(() => {
    if (!replay) return;
    const replayStartedAt = performance.now();
    let lastRenderAt = 0;
    const loop = (now: number) => {
      const progress = Math.min(1, (now - replayStartedAt) / replayMs);
      if (now - lastRenderAt >= TICK_MS || progress === 1) {
        lastRenderAt = now;
        setElapsedMs(progress * replay.durationMs);
      }
      if (progress < 1) animationFrameId.current = requestAnimationFrame(loop);
    };
    animationFrameId.current = requestAnimationFrame(loop);
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [replay, replayMs]);

  const run = async (runAllStrategies: boolean) => {
    setBusy(
      runAllStrategies
        ? '4개 전략을 순서대로 실행 중… (낙관적 락은 20초 이상 걸릴 수 있어요)'
        : `${INFO[strategy].name} 실행 중…`,
    );
    setError(null);
    try {
      const response = await fetch(`${API_URL}/coupons/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          users,
          quantity: QUANTITY,
          ...(runAllStrategies ? {} : { strategy }),
        }),
      });
      if (response.status === 429) {
        const limited = (await response.json().catch(() => ({}))) as {
          reason?: string;
          retryAfterSeconds?: number;
        };
        throw new Error(
          limited.reason === 'simulation_cooldown'
            ? `방금 시뮬레이션이 끝났어요. ${limited.retryAfterSeconds ?? '몇'}초 후 다시 실행하세요 (429, 서버 전체 쿨다운).`
            : '요청이 너무 잦아요 (429). 잠시 후 다시 시도하세요.',
        );
      }
      if (response.status === 409) throw new Error('다른 시뮬레이션이 실행 중이에요 (409).');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { results: simulationResults } = (await response.json()) as { results: Result[] };
      setResults((prev) => {
        const next = { ...prev };
        for (const simulation of simulationResults) next[simulation.strategy] = simulation;
        return next;
      });
      const resultToReplay =
        simulationResults.find((simulation) => simulation.strategy === strategy) ??
        simulationResults[0];
      setElapsedMs(0);
      setReplay(resultToReplay ?? null);
      if (resultToReplay) void loadState(resultToReplay.couponName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const selectStrategy = (selected: Strategy) => {
    setStrategy(selected);
    const previousResult = results[selected];
    if (previousResult) {
      setElapsedMs(0);
      setReplay({ ...previousResult });
      void loadState(previousResult.couponName);
    } else {
      setReplay(null);
      setDbState(null);
    }
  };

  const replayState = useMemo(
    () => (replay ? replayStateAt(replay.requests, elapsedMs) : null),
    [replay, elapsedMs],
  );
  const info = INFO[strategy];
  const done = replay ? elapsedMs >= replay.durationMs : false;

  return (
    <main className={styles.main}>
      <header>
        <p className={styles.kicker}>Stage 3 · 동시성 제어</p>
        <h1>
          쿠폰 {QUANTITY}장에 {users}명이 동시에 몰리면?
        </h1>
        <p className={styles.lead}>
          버튼을 누르면 서버가 실제 MySQL에 동시 요청 {users}개를 던지고, 각 요청의 시작·종료 시각을
          기록합니다. 아래 화면은 그 <b>실측 타임라인을 재생</b>한 것입니다.
        </p>
      </header>

      <section className={styles.tabs}>
        {ORDER.map((strategyKey) => (
          <button
            key={strategyKey}
            className={strategyKey === strategy ? styles.tabOn : styles.tab}
            style={{ '--c': INFO[strategyKey].color } as React.CSSProperties}
            onClick={() => selectStrategy(strategyKey)}
            disabled={!!busy}
          >
            <span className={styles.swatch} />
            {INFO[strategyKey].name}
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
          ▶ {info.name}로 실행
        </button>
        <button onClick={() => void run(true)} disabled={!!busy}>
          4개 전략 모두 비교
        </button>
        {replay && (
          <button onClick={() => (setElapsedMs(0), setReplay({ ...replay }))} disabled={!!busy}>
            ↺ 다시 재생
          </button>
        )}
        {busy && <span className={styles.busy}>{busy}</span>}
        {error && <span className={styles.errText}>{error}</span>}
      </section>

      <section className={styles.stage}>
        {replay && replayState ? (
          <>
            <div className={styles.meta}>
              실측 {(replay.durationMs / 1000).toFixed(2)}초 → {(replayMs / 1000).toFixed(1)}초로
              재생 · 경과 <b>{(elapsedMs / 1000).toFixed(2)}s</b>
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
                color={INFO[replay.strategy].color}
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
            {busy ? '서버에서 실행 중…' : '전략을 고르고 실행해 보세요.'}
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
    </main>
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
        <p className={styles.crowdTitle}>🔒 락 대기열 — 한 번에 한 명만 들어감</p>
        <div className={styles.queueLine}>
          {Array.from({ length: Math.max(0, dots - 1) }, (_, i) => (
            <i key={i} className={styles.qDot} />
          ))}
          {more > 0 && <span className={styles.more}>+{more}</span>}
          {inflight > 0 && <span className={styles.lockHolder}>🔑</span>}
          <span className={styles.door} />
        </div>
      </div>
    );
  }
  if (strategy === 'optimistic') {
    const bouncing = Math.min(recentRetry, MAX_DOTS);
    return (
      <div className={styles.crowd}>
        <p className={styles.crowdTitle}>↩️ version 충돌 → 튕겨나와 재시도</p>
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
        <p className={styles.crowdTitle}>🚪 조건부 UPDATE 게이트 — 판단과 증가가 한 문장</p>
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
      <p className={styles.crowdTitle}>🏃 모두가 동시에 &quot;아직 남았다&quot;를 읽고 통과</p>
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
        🎟️ 쿠폰 {quantity}장 {over > 0 && <span className={styles.errText}>+ 초과 {over}장</span>}
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
  const completedResults = ORDER.map((strategyKey) => results[strategyKey]).filter(
    (result): result is Result => !!result,
  );
  if (completedResults.length === 0) return null;
  const slowestDurationMs = Math.max(...completedResults.map((result) => result.durationMs));
  return (
    <section className={styles.card}>
      <h2>⚖️ 전략 비교 (같은 조건의 실측 결과)</h2>
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
                <b style={{ color: INFO[result.strategy].color }}>{INFO[result.strategy].name}</b>
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
                      background: INFO[result.strategy].color,
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
