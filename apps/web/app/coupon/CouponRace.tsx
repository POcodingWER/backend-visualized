'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../../lib/api';
import s from './coupon.module.css';

import { Breakdown, DbChart, DbTables, RequestLog, StrategyDetail, TruthCheck } from './DbPanels';
import type { DbState, Result, RequestTrace, Strategy } from './types';

const QTY = 100;
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
function snapshot(tl: RequestTrace[], p: number) {
  let issued = 0,
    over = 0,
    rejected = 0,
    inflight = 0,
    retries = 0,
    recentRetry = 0;
  for (const t of tl) {
    if (t.startedAtMs > p) continue;
    if (t.finishedAtMs <= p) {
      if (t.success) {
        issued++;
        if (t.oversold) over++;
      } else rejected++;
      retries += t.retries;
    } else {
      inflight++;
      // 진행 중 요청의 재시도는 경과 비율만큼 진행됐다고 근사
      retries += (t.retries * (p - t.startedAtMs)) / Math.max(1, t.durationMs);
      recentRetry += t.retries > 0 ? 1 : 0;
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
  const [p, setP] = useState(0);
  const [dbState, setDbState] = useState<DbState | null>(null);
  const loadState = async (name: string) => {
    try {
      const r = await fetch(`${API_URL}/coupons/${encodeURIComponent(name)}/state?limit=10`, {
        cache: 'no-store',
      });
      setDbState(r.ok ? ((await r.json()) as DbState) : null);
    } catch {
      setDbState(null);
    }
  };
  const raf = useRef<number | null>(null);

  // 재생: 실측 duration을 2~6초로 스케일, rAF로 돌되 setState는 TICK_MS마다
  const replayMs = replay ? Math.min(6000, Math.max(2500, replay.durationMs)) : 0;
  useEffect(() => {
    if (!replay) return;
    const start = performance.now();
    let last = 0;
    const loop = (now: number) => {
      const k = Math.min(1, (now - start) / replayMs);
      if (now - last >= TICK_MS || k === 1) {
        last = now;
        setP(k * replay.durationMs);
      }
      if (k < 1) raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [replay, replayMs]);

  const run = async (all: boolean) => {
    setBusy(
      all
        ? '4개 전략을 순서대로 실행 중… (낙관적 락은 20초 이상 걸릴 수 있어요)'
        : `${INFO[strategy].name} 실행 중…`,
    );
    setError(null);
    try {
      const r = await fetch(`${API_URL}/coupons/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users, quantity: QTY, ...(all ? {} : { strategy }) }),
      });
      if (r.status === 429) throw new Error('요청이 너무 잦아요 (429). 잠시 후 다시 시도하세요.');
      if (r.status === 409) throw new Error('다른 시뮬레이션이 실행 중이에요 (409).');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { results: list } = (await r.json()) as { results: Result[] };
      setResults((prev) => {
        const next = { ...prev };
        for (const x of list) next[x.strategy] = x;
        return next;
      });
      const show = list.find((x) => x.strategy === strategy) ?? list[0];
      setP(0);
      setReplay(show ?? null);
      if (show) void loadState(show.couponName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pick = (st: Strategy) => {
    setStrategy(st);
    const r = results[st];
    if (r) {
      setP(0);
      setReplay({ ...r });
      void loadState(r.couponName);
    } else {
      setReplay(null);
      setDbState(null);
    }
  };

  const snap = useMemo(() => (replay ? snapshot(replay.requests, p) : null), [replay, p]);
  const info = INFO[strategy];
  const done = replay ? p >= replay.durationMs : false;

  return (
    <main className={s.main}>
      <header>
        <p className={s.kicker}>Stage 3 · 동시성 제어</p>
        <h1>
          쿠폰 {QTY}장에 {users}명이 동시에 몰리면?
        </h1>
        <p className={s.lead}>
          버튼을 누르면 서버가 실제 MySQL에 동시 요청 {users}개를 던지고, 각 요청의 시작·종료 시각을
          기록합니다. 아래 화면은 그 <b>실측 타임라인을 재생</b>한 것입니다.
        </p>
      </header>

      <section className={s.tabs}>
        {ORDER.map((st) => (
          <button
            key={st}
            className={st === strategy ? s.tabOn : s.tab}
            style={{ '--c': INFO[st].color } as React.CSSProperties}
            onClick={() => pick(st)}
            disabled={!!busy}
          >
            <span className={s.swatch} />
            {INFO[st].name}
            <small>{st}</small>
          </button>
        ))}
      </section>

      <section className={s.explain} style={{ '--c': info.color } as React.CSSProperties}>
        <p>
          <b>어떻게:</b> {info.how}
        </p>
        <p>
          <b className={s.okText}>장점:</b> {info.pro} <b className={s.errText}>단점:</b> {info.con}
        </p>
      </section>

      <section className={s.controls}>
        <label>
          동시 사용자{' '}
          <select
            value={users}
            onChange={(e) => setUsers(Number(e.target.value))}
            disabled={!!busy}
          >
            {[200, 500, 1000].map((v) => (
              <option key={v} value={v}>
                {v}명
              </option>
            ))}
          </select>
        </label>
        <button className={s.primary} onClick={() => void run(false)} disabled={!!busy}>
          ▶ {info.name}로 실행
        </button>
        <button onClick={() => void run(true)} disabled={!!busy}>
          4개 전략 모두 비교
        </button>
        {replay && (
          <button onClick={() => (setP(0), setReplay({ ...replay }))} disabled={!!busy}>
            ↺ 다시 재생
          </button>
        )}
        {busy && <span className={s.busy}>{busy}</span>}
        {error && <span className={s.errText}>{error}</span>}
      </section>

      <section className={s.stage}>
        {replay && snap ? (
          <>
            <div className={s.meta}>
              실측 {(replay.durationMs / 1000).toFixed(2)}초 → {(replayMs / 1000).toFixed(1)}초로
              재생 · 경과 <b>{(p / 1000).toFixed(2)}s</b>
            </div>
            <div className={s.arena}>
              <Crowd
                strategy={replay.strategy}
                inflight={snap.inflight}
                recentRetry={snap.recentRetry}
              />
              <Grid
                quantity={replay.quantity}
                issued={snap.issued}
                over={snap.over}
                color={INFO[replay.strategy].color}
              />
            </div>
            <div className={s.counters}>
              <Counter label="발급" value={snap.issued} />
              <Counter label="초과 발급" value={snap.over} bad={snap.over > 0} />
              <Counter label="거절(매진·재시도 초과)" value={snap.rejected} />
              <Counter label="대기/진행 중 요청" value={snap.inflight} />
              <Counter label="재시도" value={snap.retries} />
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
          <p className={s.muted}>{busy ? '서버에서 실행 중…' : '전략을 고르고 실행해 보세요.'}</p>
        )}
      </section>

      {replay && (
        <>
          <section className={s.dbGrid}>
            <DbChart r={replay} p={p} />
            <DbTables r={replay} p={p} />
            <Breakdown r={replay} p={p} />
            <StrategyDetail r={replay} />
          </section>
          <TruthCheck st={dbState} onReload={() => void loadState(replay.couponName)} />
          <RequestLog key={`${replay.strategy}-${replay.durationMs}`} r={replay} />
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
    <div className={`${s.counter} ${bad ? s.counterBad : ''}`}>
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
      <div className={s.crowd}>
        <p className={s.crowdTitle}>🔒 락 대기열 — 한 번에 한 명만 들어감</p>
        <div className={s.queueLine}>
          {Array.from({ length: Math.max(0, dots - 1) }, (_, i) => (
            <i key={i} className={s.qDot} />
          ))}
          {more > 0 && <span className={s.more}>+{more}</span>}
          {inflight > 0 && <span className={s.lockHolder}>🔑</span>}
          <span className={s.door} />
        </div>
      </div>
    );
  }
  if (strategy === 'optimistic') {
    const bouncing = Math.min(recentRetry, MAX_DOTS);
    return (
      <div className={s.crowd}>
        <p className={s.crowdTitle}>↩️ version 충돌 → 튕겨나와 재시도</p>
        <div className={s.bounceArea}>
          {Array.from({ length: bouncing }, (_, i) => (
            <i
              key={i}
              className={s.bounceDot}
              style={{ left: `${(i * 37) % 92}%`, animationDelay: `${(i * 113) % 600}ms` }}
            />
          ))}
          {recentRetry - bouncing > 0 && <span className={s.more}>+{recentRetry - bouncing}</span>}
        </div>
        <p className={s.muted}>재시도 중 요청 {recentRetry}개</p>
      </div>
    );
  }
  if (strategy === 'atomic') {
    return (
      <div className={s.crowd}>
        <p className={s.crowdTitle}>🚪 조건부 UPDATE 게이트 — 판단과 증가가 한 문장</p>
        <div className={s.gateArea}>
          {Array.from({ length: Math.min(dots, 12) }, (_, i) => (
            <i
              key={i}
              className={s.rushDot}
              style={{ top: `${10 + ((i * 29) % 80)}%`, animationDelay: `${(i * 97) % 500}ms` }}
            />
          ))}
          <span className={s.gate}>issued &lt; total ?</span>
        </div>
      </div>
    );
  }
  return (
    <div className={s.crowd}>
      <p className={s.crowdTitle}>🏃 모두가 동시에 &quot;아직 남았다&quot;를 읽고 통과</p>
      <div className={s.gateArea}>
        {Array.from({ length: dots }, (_, i) => (
          <i
            key={i}
            className={`${s.rushDot} ${s.rushBad}`}
            style={{ top: `${5 + ((i * 23) % 90)}%`, animationDelay: `${(i * 71) % 500}ms` }}
          />
        ))}
        {more > 0 && <span className={s.more}>+{more}</span>}
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
    <div className={s.gridWrap}>
      <p className={s.crowdTitle}>
        🎟️ 쿠폰 {quantity}장 {over > 0 && <span className={s.errText}>+ 초과 {over}장</span>}
      </p>
      <div className={s.grid}>
        {Array.from({ length: quantity }, (_, i) => (
          <i
            key={i}
            className={i < issued - over ? s.slotOn : s.slot}
            style={{ '--c': color } as React.CSSProperties}
          />
        ))}
        {Array.from({ length: extra }, (_, i) => (
          <i key={`x${i}`} className={s.slotOver} />
        ))}
      </div>
    </div>
  );
});

const Compare = memo(function Compare({ results }: { results: Partial<Record<Strategy, Result>> }) {
  const list = ORDER.map((st) => results[st]).filter((r): r is Result => !!r);
  if (list.length === 0) return null;
  const maxMs = Math.max(...list.map((r) => r.durationMs));
  return (
    <section className={s.card}>
      <h2>⚖️ 전략 비교 (같은 조건의 실측 결과)</h2>
      <table className={s.table}>
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
          {list.map((r) => (
            <tr key={r.strategy}>
              <td>
                <b style={{ color: INFO[r.strategy].color }}>{INFO[r.strategy].name}</b>
                <small className={s.muted}>
                  {' '}
                  {r.users}명/{r.quantity}장
                </small>
              </td>
              <td>{r.final.issueRows}</td>
              <td className={r.final.oversold > 0 ? s.errText : s.okText}>{r.final.oversold}</td>
              <td className={r.final.counterMismatch ? s.errText : ''}>{r.final.issuedCount}</td>
              <td>{r.summary.totalRetries.toLocaleString()}</td>
              <td className={r.summary.retry_exhausted + r.summary.error > 0 ? s.errText : ''}>
                {r.summary.retry_exhausted + r.summary.error}
              </td>
              <td>
                <span className={s.barWrap}>
                  <span
                    className={s.bar}
                    style={{
                      width: `${(r.durationMs / maxMs) * 100}%`,
                      background: INFO[r.strategy].color,
                    }}
                  />
                </span>
                {(r.durationMs / 1000).toFixed(2)}s
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={s.muted}>
        참고: docs/benchmarks/stage3-coupon.md 실측(500명 vs 100장, M1 Pro 로컬) — none 400장 초과
        발급, pessimistic ~1.7s, optimistic 재시도 ~14,000회·60장만 발급·~24s, atomic ~0.4s.
      </p>
    </section>
  );
});
