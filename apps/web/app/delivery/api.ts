import { callApi } from '../../lib/api';
import type { Daily } from './DailyChart';

/**
 * 3장 묶음배송 API (events 모듈). 클릭 기록 자체는 @bv/sdk 트래커가 보낸다(Pipeline.tsx).
 * 여기엔 화면이 직접 부르는 비교·체험·통계 호출만 둔다.
 */

/** 지금까지 저장된 이벤트 수 (카운트 쿼리) */
export const loadStoredTotal = () => callApi<{ total: number }>('/events/stats');

/** 날짜별 집계표(EventDailyStat) — 배치 집계가 만든 결과 */
export const loadDailyStats = () => callApi<Daily>('/events/stats/daily');

export type SendResult = { requests: number; ms: number; rejected: number };

/**
 * 같은 이벤트 eventCount개를 실제 API로 두 번 보낸다: 이벤트마다 POST /events(동시 10) → 100개씩 POST /events/batch.
 * rejected = 레이트 리밋(429)이나 네트워크 오류로 저장되지 않은 요청 수.
 */
export async function sendEventsBothWays(
  eventCount: number,
  {
    onSingleProgress,
    onBatchProgress,
  }: { onSingleProgress?: (done: number) => void; onBatchProgress?: (done: number) => void } = {},
): Promise<{ single: SendResult; batch: SendResult }> {
  const makeEvent = (eventIndex: number, mode: string) => ({
    name: 'compare_demo',
    properties: { mode, i: eventIndex },
    sessionId: 'compare-demo',
    occurredAt: new Date().toISOString(),
  });
  const isStored = (response: { status: number } | null) => !!response && response.status < 300;

  let startedAt = performance.now();
  let next = 0;
  let done = 0;
  let singleRejected = 0;
  const worker = async () => {
    while (next < eventCount) {
      const eventIndex = next++;
      const response = await callApi('/events', { json: makeEvent(eventIndex, 'single') }).catch(
        () => null,
      );
      if (!isStored(response)) singleRejected++;
      onSingleProgress?.(++done);
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  const single = {
    requests: eventCount,
    ms: performance.now() - startedAt,
    rejected: singleRejected,
  };

  startedAt = performance.now();
  let batchRequests = 0;
  let batchRejected = 0;
  for (let i = 0; i < eventCount; i += 100) {
    const events = Array.from({ length: Math.min(100, eventCount - i) }, (_, k) =>
      makeEvent(i + k, 'batch'),
    );
    const response = await callApi('/events/batch', { json: { events } }).catch(() => null);
    if (!isStored(response)) batchRejected++;
    onBatchProgress?.(++batchRequests);
  }
  return {
    single,
    batch: { requests: batchRequests, ms: performance.now() - startedAt, rejected: batchRejected },
  };
}

export type ProbeCounts = { ok: number; limited: number; other: number };

/** 레이트 리밋 체험: DB에 쓰지 않는 /events/demo/rate-limit-probe로 요청 total개를 동시 15개씩 몰아 보낸다 */
export async function probeRateLimit(total: number, onProgress?: (counts: ProbeCounts) => void) {
  const counts: ProbeCounts = { ok: 0, limited: 0, other: 0 };
  let next = 0;
  const worker = async () => {
    while (next < total) {
      next++;
      const response = await callApi('/events/demo/rate-limit-probe', { method: 'POST' }).catch(
        () => null,
      );
      if (response?.status === 202) counts.ok++;
      else if (response?.status === 429) counts.limited++;
      else counts.other++;
      onProgress?.(counts);
    }
  };
  await Promise.all(Array.from({ length: 15 }, worker));
  return { ...counts };
}

export type AggregateResult = {
  rows: number;
  ms: number;
  from: string;
  to: string;
  cooldownSeconds: number;
};

/** 공개 데모용 집계 실행 (전역 쿨다운이 있어 429면 retryAfterSeconds를 돌려준다) */
export async function runDemoAggregate(): Promise<
  { result: AggregateResult } | { retryAfterSeconds: number | undefined } | { error: string }
> {
  try {
    const response = await callApi<AggregateResult & { retryAfterSeconds?: number }>(
      '/events/demo/aggregate',
      { method: 'POST' },
    );
    if (response.status === 429) return { retryAfterSeconds: response.body.retryAfterSeconds };
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return { result: response.body };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
