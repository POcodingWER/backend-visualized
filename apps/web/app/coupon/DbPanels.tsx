'use client';

import { memo, useMemo, useState } from 'react';
import s from './coupon.module.css';
import { OUTCOME_COLOR, OUTCOME_KO, type DbState, type Outcome, type Result } from './types';

const fmt = (ms: number) => `${(ms / 1000).toFixed(3)}s`;

/** 진행 시간 p 기준 마지막 DB 스냅샷 */
function snapAt(r: Result, p: number) {
  let last = r.dbSnapshots[0]!;
  for (const x of r.dbSnapshots) {
    if (x.atMs > p) break;
    last = x;
  }
  return last;
}

/** DB 카운터(issuedCount) vs 실제 행 수(COUNT CouponIssue) 두 선. SVG polyline (가벼움) */
export const DbChart = memo(function DbChart({ r, p }: { r: Result; p: number }) {
  const W = 520;
  const H = 180;
  const maxY =
    Math.max(r.quantity, r.final.issueRows, ...r.dbSnapshots.map((x) => x.issueRows)) * 1.05;
  const x = (ms: number) => (ms / Math.max(1, r.durationMs)) * W;
  const y = (v: number) => H - (v / maxY) * H;
  const pts = r.dbSnapshots.filter((d) => d.atMs <= p);
  const line = (k: 'issuedCount' | 'issueRows') =>
    pts.map((d) => `${x(d.atMs).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const cur = snapAt(r, p);
  return (
    <div className={s.panel}>
      <p className={s.crowdTitle}>📈 DB 관찰 (별도 커넥션으로 {r.dbSnapshots.length}회 샘플링)</p>
      <svg viewBox={`0 0 ${W} ${H + 4}`} className={s.svg} preserveAspectRatio="none">
        <line
          x1={0}
          x2={W}
          y1={y(r.quantity)}
          y2={y(r.quantity)}
          stroke="#facc15"
          strokeDasharray="4 4"
        />
        <text x={4} y={y(r.quantity) - 4} fill="#facc15" fontSize={11}>
          총 수량 {r.quantity}
        </text>
        <polyline points={line('issueRows')} fill="none" stroke="#fb7185" strokeWidth={2.5} />
        <polyline points={line('issuedCount')} fill="none" stroke="#818cf8" strokeWidth={2.5} />
        <line x1={x(p)} x2={x(p)} y1={0} y2={H} stroke="#334" />
      </svg>
      <div className={s.legend}>
        <span>
          <i style={{ background: '#fb7185' }} /> 실제 발급 행 COUNT(CouponIssue) ={' '}
          <b>{cur.issueRows}</b>
        </span>
        <span>
          <i style={{ background: '#818cf8' }} /> 카운터 Coupon.issuedCount ={' '}
          <b>{cur.issuedCount}</b>
        </span>
      </div>
      {cur.issueRows !== cur.issuedCount && (
        <p className={s.errText} style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
          카운터와 실제 행 수가 {Math.abs(cur.issueRows - cur.issuedCount)}만큼 어긋남 — 서로의
          쓰기를 덮어쓰는 lost update
        </p>
      )}
    </div>
  );
});

/** Coupon 행 + CouponIssue 테이블이 쌓이는 모습 (최신 10행만 렌더) */
export const DbTables = memo(function DbTables({ r, p }: { r: Result; p: number }) {
  const cur = snapAt(r, p);
  const rows = useMemo(() => {
    const done = r.requests.filter((q) => q.success && q.finishedAtMs <= p);
    return { count: done.length, latest: done.slice(-10).reverse() };
  }, [r, p]);
  return (
    <div className={s.panel}>
      <p className={s.crowdTitle}>🗄️ Coupon 테이블</p>
      <table className={s.dbTable}>
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>totalQuantity</th>
            <th>issuedCount</th>
            <th>version</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{r.couponId}</td>
            <td>{r.couponName}</td>
            <td>{r.quantity}</td>
            <td className={cur.issuedCount !== cur.issueRows ? s.errText : ''}>
              {cur.issuedCount}
            </td>
            <td>{cur.version}</td>
          </tr>
        </tbody>
      </table>
      <p className={s.crowdTitle} style={{ marginTop: '0.8rem' }}>
        🧾 CouponIssue 테이블 — <b>{rows.count}</b>행 (최신 10행)
      </p>
      <table className={s.dbTable}>
        <thead>
          <tr>
            <th>id</th>
            <th>userId</th>
            <th>createdAt(+ms)</th>
            <th>순번</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.latest.map((q) => (
            <tr key={q.requestId} className={`${s.rowIn} ${q.oversold ? s.rowOver : ''}`}>
              <td>{q.issueRowId}</td>
              <td>{q.userId}</td>
              <td>{fmt(q.finishedAtMs)}</td>
              <td>
                {q.issueSeq}/{r.quantity}
              </td>
              <td>{q.oversold ? '초과 발급' : ''}</td>
            </tr>
          ))}
          {rows.latest.length === 0 && (
            <tr>
              <td colSpan={5} className={s.muted}>
                (아직 없음)
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
});

/** 결과별 분포 (진행 시간 p 기준) + 락 대기 중 */
export const Breakdown = memo(function Breakdown({ r, p }: { r: Result; p: number }) {
  const c = useMemo(() => {
    const m: Record<Outcome, number> = { issued: 0, sold_out: 0, retry_exhausted: 0, error: 0 };
    let waiting = 0;
    for (const q of r.requests) {
      if (q.finishedAtMs <= p) m[q.result]++;
      else if (q.startedAtMs <= p) waiting++;
    }
    return { m, waiting };
  }, [r, p]);
  const items: { label: string; v: number; color: string }[] = [
    ...(Object.keys(OUTCOME_KO) as Outcome[]).map((k) => ({
      label: OUTCOME_KO[k],
      v: c.m[k],
      color: OUTCOME_COLOR[k],
    })),
    {
      label:
        r.strategy === 'pessimistic'
          ? '락 대기'
          : r.strategy === 'optimistic'
            ? '재시도 중'
            : '처리 중',
      v: c.waiting,
      color: '#facc15',
    },
  ];
  return (
    <div className={s.panel}>
      <p className={s.crowdTitle}>🚦 요청 {r.users}개는 어떻게 끝났나</p>
      {items.map((it) => (
        <div key={it.label} className={s.bdRow}>
          <span>{it.label}</span>
          <span className={s.barWrap}>
            <span
              className={s.bar}
              style={{ width: `${(it.v / r.users) * 100}%`, background: it.color }}
            />
          </span>
          <b>{it.v}</b>
        </div>
      ))}
    </div>
  );
});

const pct = (arr: number[], q: number) => {
  if (arr.length === 0) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))]!;
};

/** 전략별 상세: 비관적 락 대기, 낙관적 재시도 분포, 원자적 affectedRows=0 */
export const StrategyDetail = memo(function StrategyDetail({ r }: { r: Result }) {
  if (r.strategy === 'pessimistic') {
    const lock = r.requests.map((q) => q.lockWaitMs ?? 0);
    const pool = r.requests.map((q) => q.poolWaitMs ?? 0);
    const row = (name: string, a: number[]) => (
      <tr>
        <td>{name}</td>
        <td>{pct(a, 0.5).toFixed(1)}ms</td>
        <td>{pct(a, 0.95).toFixed(1)}ms</td>
        <td>{Math.max(...a).toFixed(1)}ms</td>
      </tr>
    );
    return (
      <div className={s.panel}>
        <p className={s.crowdTitle}>🔒 비관적 락: 요청들은 얼마나 기다렸나</p>
        <table className={s.dbTable}>
          <thead>
            <tr>
              <th />
              <th>p50</th>
              <th>p95</th>
              <th>max</th>
            </tr>
          </thead>
          <tbody>
            {row('커넥션 풀 대기 (트랜잭션 시작 전)', pool)}
            {row('행 락 대기 (SELECT … FOR UPDATE)', lock)}
          </tbody>
        </table>
        <p className={s.muted}>
          대기 중인 트랜잭션은 커넥션을 붙잡고 있어서, 뒤의 요청은 풀에서 커넥션을 얻는 것부터
          기다립니다.
        </p>
      </div>
    );
  }
  if (r.strategy === 'optimistic') {
    const buckets = [
      { label: '0회', f: (n: number) => n === 0 },
      { label: '1~5회', f: (n: number) => n >= 1 && n <= 5 },
      { label: '6~10회', f: (n: number) => n >= 6 && n <= 10 },
      { label: '11~20회', f: (n: number) => n >= 11 && n <= 20 },
      { label: '21~29회', f: (n: number) => n >= 21 && n <= 29 },
      { label: '30회 (한도)', f: (n: number) => n >= 30 },
    ].map((b) => ({ ...b, v: r.requests.filter((q) => b.f(q.retries)).length }));
    const max = Math.max(1, ...buckets.map((b) => b.v));
    return (
      <div className={s.panel}>
        <p className={s.crowdTitle}>
          ↩️ 낙관적 락: 요청당 재시도 횟수 분포 (총 {r.summary.totalRetries.toLocaleString()}회)
        </p>
        {buckets.map((b) => (
          <div key={b.label} className={s.bdRow}>
            <span>{b.label}</span>
            <span className={s.barWrap}>
              <span
                className={s.bar}
                style={{ width: `${(b.v / max) * 100}%`, background: '#22d3ee' }}
              />
            </span>
            <b>{b.v}</b>
          </div>
        ))}
      </div>
    );
  }
  if (r.strategy === 'atomic') {
    const zero = r.requests.filter((q) => q.affectedRows === 0).length;
    const one = r.requests.filter((q) => q.affectedRows === 1).length;
    return (
      <div className={s.panel}>
        <p className={s.crowdTitle}>🚪 원자적 UPDATE: affectedRows</p>
        <p>
          <code>UPDATE … WHERE issuedCount &lt; totalQuantity</code>
        </p>
        <p>
          affectedRows = 1 → 발급: <b className={s.okText}>{one}</b>건 · affectedRows = 0 → 품절로
          거절: <b>{zero}</b>건
        </p>
        <p className={s.muted}>
          조건을 만족하지 않으면 DB가 0행을 갱신하고 끝 — 읽기와 판단 사이의 틈이 없습니다.
        </p>
      </div>
    );
  }
  const reads = new Map<number, number>();
  for (const q of r.requests)
    if (q.readIssuedCount !== undefined)
      reads.set(q.readIssuedCount, (reads.get(q.readIssuedCount) ?? 0) + 1);
  const top = [...reads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div className={s.panel}>
      <p className={s.crowdTitle}>🏃 제어 없음: 요청들이 읽은 issuedCount</p>
      {top.map(([v, n]) => (
        <p key={v} style={{ margin: '0.2rem 0' }}>
          issuedCount = <b>{v}</b> 을 읽은 요청 <b className={s.errText}>{n}</b>개
        </p>
      ))}
      <p className={s.muted}>
        같은 값을 읽은 요청들은 모두 &quot;남았다&quot;고 판단하고 발급 → 그리고 모두 (읽은 값 +
        1)을 써서 카운터가 거의 오르지 않습니다.
      </p>
    </div>
  );
});

const PAGE = 50;
/** 요청별 로그: 결과 필터 + 50개씩 페이지 */
export const RequestLog = memo(function RequestLog({ r }: { r: Result }) {
  const [filter, setFilter] = useState<Outcome | 'all' | 'oversold'>('all');
  const [page, setPage] = useState(0);
  const list = useMemo(
    () =>
      filter === 'all'
        ? r.requests
        : filter === 'oversold'
          ? r.requests.filter((q) => q.oversold)
          : r.requests.filter((q) => q.result === filter),
    [r, filter],
  );
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const rows = list.slice(cur * PAGE, cur * PAGE + PAGE);
  const showLock = r.strategy === 'pessimistic';
  const opts: { k: typeof filter; label: string }[] = [
    { k: 'all', label: `전체 ${r.requests.length}` },
    ...(Object.keys(OUTCOME_KO) as Outcome[]).map((k) => ({
      k,
      label: `${OUTCOME_KO[k]} ${r.summary[k]}`,
    })),
    ...(r.final.oversold > 0
      ? [{ k: 'oversold' as const, label: `초과 발급 ${r.final.oversold}` }]
      : []),
  ];
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <h2>📋 요청별 로그 (완료 순)</h2>
        <div className={s.filters}>
          {opts.map((o) => (
            <button
              key={o.k}
              className={filter === o.k ? s.primary : ''}
              onClick={() => {
                setFilter(o.k);
                setPage(0);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>사용자</th>
            <th>시작</th>
            <th>종료</th>
            <th>소요</th>
            <th>재시도</th>
            {showLock && <th>락 대기</th>}
            <th>결과</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.requestId}>
              <td>{q.requestId}</td>
              <td>{q.userId}</td>
              <td>{q.startedAtMs.toFixed(1)}ms</td>
              <td>{q.finishedAtMs.toFixed(1)}ms</td>
              <td>{q.durationMs.toFixed(1)}ms</td>
              <td>{q.retries}</td>
              {showLock && <td>{(q.lockWaitMs ?? 0).toFixed(1)}ms</td>}
              <td style={{ color: q.oversold ? '#fb7185' : OUTCOME_COLOR[q.result] }}>
                {OUTCOME_KO[q.result]}
                {q.oversold && ' (초과 발급)'}
                {q.affectedRows === 0 && ' · affectedRows 0'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={s.pager}>
        <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>
          ← 이전
        </button>
        <span>
          {cur + 1} / {pages} ({list.length}건)
        </span>
        <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
          다음 →
        </button>
      </div>
    </section>
  );
});

/** 실행 후 GET /coupons/:name/state 로 실제 DB를 다시 읽어 확인 */
export const TruthCheck = memo(function TruthCheck({
  st,
  onReload,
}: {
  st: DbState | null;
  onReload: () => void;
}) {
  if (!st) return null;
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <h2>✅ 실제 DB 확인 — GET /coupons/{st.coupon.name}/state</h2>
        <button onClick={onReload}>다시 읽기</button>
      </div>
      <p>
        Coupon(id {st.coupon.id}): totalQuantity <b>{st.coupon.totalQuantity}</b> · issuedCount{' '}
        <b className={st.counterMismatch ? s.errText : ''}>{st.coupon.issuedCount}</b> · version{' '}
        <b>{st.coupon.version}</b> · CouponIssue 행{' '}
        <b className={st.oversold ? s.errText : s.okText}>{st.issueRows}</b>
        {st.oversold > 0 && <span className={s.errText}> (초과 {st.oversold}행)</span>}
        {st.counterMismatch && <span className={s.errText}> · 카운터 ≠ 행 수</span>}
      </p>
      <table className={s.dbTable}>
        <thead>
          <tr>
            <th>id</th>
            <th>userId</th>
            <th>createdAt</th>
            <th>순위</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {st.recentIssues.map((x) => (
            <tr key={x.id} className={x.oversold ? s.rowOver : ''}>
              <td>{x.id}</td>
              <td>{x.userId}</td>
              <td>
                {new Date(x.createdAt).toLocaleTimeString('ko-KR', {
                  hour12: false,
                  fractionalSecondDigits: 3,
                })}
              </td>
              <td>{x.rank}</td>
              <td>{x.oversold ? '초과 발급' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
});
