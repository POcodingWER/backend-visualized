'use client';

import { memo, useMemo, useState } from 'react';
import styles from './coupon.module.css';
import { OUTCOME_COLOR, OUTCOME_KO, type DbState, type Outcome, type Result } from './types';

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(3)}s`;

/** 진행 시간 p 기준 마지막 DB 스냅샷 */
function dbSnapshotAt(result: Result, elapsedMs: number) {
  let last = result.dbSnapshots[0]!;
  for (const snapshot of result.dbSnapshots) {
    if (snapshot.atMs > elapsedMs) break;
    last = snapshot;
  }
  return last;
}

/** DB 카운터(issuedCount) vs 실제 행 수(COUNT CouponIssue) 두 선. SVG polyline (가벼움) */
export const DbChart = memo(function DbChart({
  result,
  elapsedMs,
}: {
  result: Result;
  elapsedMs: number;
}) {
  const chartWidth = 520;
  const chartHeight = 180;
  const maxY =
    Math.max(
      result.quantity,
      result.final.issueRows,
      ...result.dbSnapshots.map((snapshot) => snapshot.issueRows),
    ) * 1.05;
  const toChartX = (ms: number) => (ms / Math.max(1, result.durationMs)) * chartWidth;
  const toChartY = (value: number) => chartHeight - (value / maxY) * chartHeight;
  const visibleSnapshots = result.dbSnapshots.filter((snapshot) => snapshot.atMs <= elapsedMs);
  const polylinePoints = (field: 'issuedCount' | 'issueRows') =>
    visibleSnapshots
      .map(
        (snapshot) =>
          `${toChartX(snapshot.atMs).toFixed(1)},${toChartY(snapshot[field]).toFixed(1)}`,
      )
      .join(' ');
  const currentSnapshot = dbSnapshotAt(result, elapsedMs);
  return (
    <div className={styles.panel}>
      <p className={styles.crowdTitle}>
        DB 관찰 (별도 커넥션으로 {result.dbSnapshots.length}회 샘플링)
      </p>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight + 4}`}
        className={styles.svg}
        preserveAspectRatio="none"
      >
        <line
          x1={0}
          x2={chartWidth}
          y1={toChartY(result.quantity)}
          y2={toChartY(result.quantity)}
          stroke="#8E4F1F"
          strokeDasharray="4 4"
        />
        <text x={4} y={toChartY(result.quantity) - 4} fill="#8E4F1F" fontSize={11}>
          총 수량 {result.quantity}
        </text>
        <polyline
          points={polylinePoints('issueRows')}
          fill="none"
          stroke="#A3321F"
          strokeWidth={2.5}
        />
        <polyline
          points={polylinePoints('issuedCount')}
          fill="none"
          stroke="#345E72"
          strokeWidth={2.5}
        />
        <line
          x1={toChartX(elapsedMs)}
          x2={toChartX(elapsedMs)}
          y1={0}
          y2={chartHeight}
          stroke="#B9AC95"
        />
      </svg>
      <div className={styles.legend}>
        <span>
          <i style={{ background: '#A3321F' }} /> 실제 발급 행 COUNT(CouponIssue) ={' '}
          <b>{currentSnapshot.issueRows}</b>
        </span>
        <span>
          <i style={{ background: '#345E72' }} /> 카운터 Coupon.issuedCount ={' '}
          <b>{currentSnapshot.issuedCount}</b>
        </span>
      </div>
      {currentSnapshot.issueRows !== currentSnapshot.issuedCount && (
        <p className={styles.errText} style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
          카운터와 실제 행 수가 {Math.abs(currentSnapshot.issueRows - currentSnapshot.issuedCount)}
          만큼 어긋남 — 서로의 쓰기를 덮어쓰는 lost update
        </p>
      )}
    </div>
  );
});

/** Coupon 행 + CouponIssue 테이블이 쌓이는 모습 (최신 10행만 렌더) */
export const DbTables = memo(function DbTables({
  result,
  elapsedMs,
}: {
  result: Result;
  elapsedMs: number;
}) {
  const currentSnapshot = dbSnapshotAt(result, elapsedMs);
  const rows = useMemo(() => {
    const done = result.requests.filter(
      (request) => request.success && request.finishedAtMs <= elapsedMs,
    );
    return { count: done.length, latest: done.slice(-10).reverse() };
  }, [result, elapsedMs]);
  return (
    <div className={styles.panel}>
      <p className={styles.crowdTitle}>Coupon 테이블</p>
      <table className={styles.dbTable}>
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
            <td>{result.couponId}</td>
            <td>{result.couponName}</td>
            <td>{result.quantity}</td>
            <td
              className={
                currentSnapshot.issuedCount !== currentSnapshot.issueRows ? styles.errText : ''
              }
            >
              {currentSnapshot.issuedCount}
            </td>
            <td>{currentSnapshot.version}</td>
          </tr>
        </tbody>
      </table>
      <p className={styles.crowdTitle} style={{ marginTop: '0.8rem' }}>
        CouponIssue 테이블 — <b>{rows.count}</b>행 (최신 10행)
      </p>
      <table className={styles.dbTable}>
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
          {rows.latest.map((request) => (
            <tr
              key={request.requestId}
              className={`${styles.rowIn} ${request.oversold ? styles.rowOver : ''}`}
            >
              <td>{request.issueRowId}</td>
              <td>{request.userId}</td>
              <td>{formatSeconds(request.finishedAtMs)}</td>
              <td>
                {request.issueSeq}/{result.quantity}
              </td>
              <td>{request.oversold ? '초과 발급' : ''}</td>
            </tr>
          ))}
          {rows.latest.length === 0 && (
            <tr>
              <td colSpan={5} className={styles.muted}>
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
export const Breakdown = memo(function Breakdown({
  result,
  elapsedMs,
}: {
  result: Result;
  elapsedMs: number;
}) {
  const breakdown = useMemo(() => {
    const countsByOutcome: Record<Outcome, number> = {
      issued: 0,
      sold_out: 0,
      retry_exhausted: 0,
      error: 0,
    };
    let waiting = 0;
    for (const request of result.requests) {
      if (request.finishedAtMs <= elapsedMs) countsByOutcome[request.result]++;
      else if (request.startedAtMs <= elapsedMs) waiting++;
    }
    return { countsByOutcome, waiting };
  }, [result, elapsedMs]);
  const items: { label: string; value: number; color: string }[] = [
    ...(Object.keys(OUTCOME_KO) as Outcome[]).map((outcome) => ({
      label: OUTCOME_KO[outcome],
      value: breakdown.countsByOutcome[outcome],
      color: OUTCOME_COLOR[outcome],
    })),
    {
      label:
        result.strategy === 'pessimistic'
          ? '락 대기'
          : result.strategy === 'optimistic'
            ? '재시도 중'
            : '처리 중',
      value: breakdown.waiting,
      color: '#8E4F1F',
    },
  ];
  return (
    <div className={styles.panel}>
      <p className={styles.crowdTitle}>요청 {result.users}개는 어떻게 끝났나</p>
      {items.map((item) => (
        <div key={item.label} className={styles.bdRow}>
          <span>{item.label}</span>
          <span className={styles.barWrap}>
            <span
              className={styles.bar}
              style={{ width: `${(item.value / result.users) * 100}%`, background: item.color }}
            />
          </span>
          <b>{item.value}</b>
        </div>
      ))}
    </div>
  );
});

const percentile = (values: number[], quantile: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))]!;
};

/** 전략별 상세: 비관적 락 대기, 낙관적 재시도 분포, 원자적 affectedRows=0 */
export const StrategyDetail = memo(function StrategyDetail({ result }: { result: Result }) {
  if (result.strategy === 'pessimistic') {
    const lockWaits = result.requests.map((request) => request.lockWaitMs ?? 0);
    const poolWaits = result.requests.map((request) => request.poolWaitMs ?? 0);
    const waitRow = (name: string, waitTimes: number[]) => (
      <tr>
        <td>{name}</td>
        <td>{percentile(waitTimes, 0.5).toFixed(1)}ms</td>
        <td>{percentile(waitTimes, 0.95).toFixed(1)}ms</td>
        <td>{Math.max(...waitTimes).toFixed(1)}ms</td>
      </tr>
    );
    return (
      <div className={styles.panel}>
        <p className={styles.crowdTitle}>비관적 락: 요청들은 얼마나 기다렸나</p>
        <table className={styles.dbTable}>
          <thead>
            <tr>
              <th />
              <th>p50</th>
              <th>p95</th>
              <th>max</th>
            </tr>
          </thead>
          <tbody>
            {waitRow('커넥션 풀 대기 (트랜잭션 시작 전)', poolWaits)}
            {waitRow('행 락 대기 (SELECT … FOR UPDATE)', lockWaits)}
          </tbody>
        </table>
        <p className={styles.muted}>
          대기 중인 트랜잭션은 커넥션을 붙잡고 있어서, 뒤의 요청은 풀에서 커넥션을 얻는 것부터
          기다립니다.
        </p>
      </div>
    );
  }
  if (result.strategy === 'optimistic') {
    const buckets = [
      { label: '0회', matches: (retries: number) => retries === 0 },
      { label: '1~5회', matches: (retries: number) => retries >= 1 && retries <= 5 },
      { label: '6~10회', matches: (retries: number) => retries >= 6 && retries <= 10 },
      { label: '11~20회', matches: (retries: number) => retries >= 11 && retries <= 20 },
      { label: '21~29회', matches: (retries: number) => retries >= 21 && retries <= 29 },
      { label: '30회 (한도)', matches: (retries: number) => retries >= 30 },
    ].map((bucket) => ({
      ...bucket,
      count: result.requests.filter((request) => bucket.matches(request.retries)).length,
    }));
    const maxBucketCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
    return (
      <div className={styles.panel}>
        <p className={styles.crowdTitle}>
          낙관적 락: 요청당 재시도 횟수 분포 (총 {result.summary.totalRetries.toLocaleString()}
          회)
        </p>
        {buckets.map((bucket) => (
          <div key={bucket.label} className={styles.bdRow}>
            <span>{bucket.label}</span>
            <span className={styles.barWrap}>
              <span
                className={styles.bar}
                style={{
                  width: `${(bucket.count / maxBucketCount) * 100}%`,
                  background: '#345E72',
                }}
              />
            </span>
            <b>{bucket.count}</b>
          </div>
        ))}
      </div>
    );
  }
  if (result.strategy === 'atomic') {
    const rejectedCount = result.requests.filter((request) => request.affectedRows === 0).length;
    const issuedCount = result.requests.filter((request) => request.affectedRows === 1).length;
    return (
      <div className={styles.panel}>
        <p className={styles.crowdTitle}>원자적 UPDATE: affectedRows</p>
        <p>
          <code>UPDATE … WHERE issuedCount &lt; totalQuantity</code>
        </p>
        <p>
          affectedRows = 1 → 발급: <b className={styles.okText}>{issuedCount}</b>건 · affectedRows =
          0 → 품절로 거절: <b>{rejectedCount}</b>건
        </p>
        <p className={styles.muted}>
          조건을 만족하지 않으면 DB가 0행을 갱신하고 끝 — 읽기와 판단 사이의 틈이 없습니다.
        </p>
      </div>
    );
  }
  const readCountByValue = new Map<number, number>();
  for (const request of result.requests)
    if (request.readIssuedCount !== undefined)
      readCountByValue.set(
        request.readIssuedCount,
        (readCountByValue.get(request.readIssuedCount) ?? 0) + 1,
      );
  const mostReadValues = [...readCountByValue.entries()]
    .sort((left, bucket) => bucket[1] - left[1])
    .slice(0, 5);
  return (
    <div className={styles.panel}>
      <p className={styles.crowdTitle}>제어 없음: 요청들이 읽은 issuedCount</p>
      {mostReadValues.map(([v, n]) => (
        <p key={v} style={{ margin: '0.2rem 0' }}>
          issuedCount = <b>{v}</b> 을 읽은 요청 <b className={styles.errText}>{n}</b>개
        </p>
      ))}
      <p className={styles.muted}>
        같은 값을 읽은 요청들은 모두 &quot;남았다&quot;고 판단하고 발급 → 그리고 모두 (읽은 값 +
        1)을 써서 카운터가 거의 오르지 않습니다.
      </p>
    </div>
  );
});

const PAGE = 50;
/** 요청별 로그: 결과 필터 + 50개씩 페이지 */
export const RequestLog = memo(function RequestLog({ result }: { result: Result }) {
  const [filter, setFilter] = useState<Outcome | 'all' | 'oversold'>('all');
  const [page, setPage] = useState(0);
  const filteredRequests = useMemo(
    () =>
      filter === 'all'
        ? result.requests
        : filter === 'oversold'
          ? result.requests.filter((request) => request.oversold)
          : result.requests.filter((request) => request.result === filter),
    [result, filter],
  );
  const pages = Math.max(1, Math.ceil(filteredRequests.length / PAGE));
  const currentPage = Math.min(page, pages - 1);
  const rows = filteredRequests.slice(currentPage * PAGE, currentPage * PAGE + PAGE);
  const showLock = result.strategy === 'pessimistic';
  const filterOptions: { filterValue: typeof filter; label: string }[] = [
    { filterValue: 'all', label: `전체 ${result.requests.length}` },
    ...(Object.keys(OUTCOME_KO) as Outcome[]).map((outcome) => ({
      filterValue: outcome,
      label: `${OUTCOME_KO[outcome]} ${result.summary[outcome]}`,
    })),
    ...(result.final.oversold > 0
      ? [{ filterValue: 'oversold' as const, label: `초과 발급 ${result.final.oversold}` }]
      : []),
  ];
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>요청별 로그 (완료 순)</h2>
        <div className={styles.filters}>
          {filterOptions.map((option) => (
            <button
              key={option.filterValue}
              className={filter === option.filterValue ? styles.primary : ''}
              onClick={() => {
                setFilter(option.filterValue);
                setPage(0);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <table className={styles.table}>
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
          {rows.map((request) => (
            <tr key={request.requestId}>
              <td>{request.requestId}</td>
              <td>{request.userId}</td>
              <td>{request.startedAtMs.toFixed(1)}ms</td>
              <td>{request.finishedAtMs.toFixed(1)}ms</td>
              <td>{request.durationMs.toFixed(1)}ms</td>
              <td>{request.retries}</td>
              {showLock && <td>{(request.lockWaitMs ?? 0).toFixed(1)}ms</td>}
              <td style={{ color: request.oversold ? '#A3321F' : OUTCOME_COLOR[request.result] }}>
                {OUTCOME_KO[request.result]}
                {request.oversold && ' (초과 발급)'}
                {request.affectedRows === 0 && ' · affectedRows 0'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.pager}>
        <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
          ← 이전
        </button>
        <span>
          {currentPage + 1} / {pages} ({filteredRequests.length}건)
        </span>
        <button disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>
          다음 →
        </button>
      </div>
    </section>
  );
});

/** 실행 후 GET /coupons/:name/state 로 실제 DB를 다시 읽어 확인 */
export const TruthCheck = memo(function TruthCheck({
  dbState,
  onReload,
}: {
  dbState: DbState | null;
  onReload: () => void;
}) {
  if (!dbState) return null;
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>실제 DB 확인 — GET /coupons/{dbState.coupon.name}/state</h2>
        <button onClick={onReload}>다시 읽기</button>
      </div>
      <p>
        Coupon(id {dbState.coupon.id}): totalQuantity <b>{dbState.coupon.totalQuantity}</b> ·
        issuedCount{' '}
        <b className={dbState.counterMismatch ? styles.errText : ''}>
          {dbState.coupon.issuedCount}
        </b>{' '}
        · version <b>{dbState.coupon.version}</b> · CouponIssue 행{' '}
        <b className={dbState.oversold ? styles.errText : styles.okText}>{dbState.issueRows}</b>
        {dbState.oversold > 0 && (
          <span className={styles.errText}> (초과 {dbState.oversold}행)</span>
        )}
        {dbState.counterMismatch && <span className={styles.errText}> · 카운터 ≠ 행 수</span>}
      </p>
      <table className={styles.dbTable}>
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
          {dbState.recentIssues.map((issue) => (
            <tr key={issue.id} className={issue.oversold ? styles.rowOver : ''}>
              <td>{issue.id}</td>
              <td>{issue.userId}</td>
              <td>
                {new Date(issue.createdAt).toLocaleTimeString('ko-KR', {
                  hour12: false,
                  fractionalSecondDigits: 3,
                })}
              </td>
              <td>{issue.rank}</td>
              <td>{issue.oversold ? '초과 발급' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
});
