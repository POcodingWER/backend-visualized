import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayStateAt } from './simulation';
import type { RequestTrace } from './types';

const trace = (overrides: Partial<RequestTrace>): RequestTrace => ({
  requestId: 1,
  userId: 'user-1',
  startedAtMs: 0,
  finishedAtMs: 10,
  durationMs: 10,
  success: true,
  result: 'issued',
  retries: 0,
  oversold: false,
  ...overrides,
});

test('replay state counts finished, in-flight and not-yet-started requests at a moment', () => {
  const requests = [
    trace({ finishedAtMs: 10 }),
    trace({ finishedAtMs: 20, durationMs: 20, oversold: true }),
    trace({ startedAtMs: 0, finishedAtMs: 40, durationMs: 40, retries: 4 }),
    trace({ startedAtMs: 50, finishedAtMs: 60, success: false, result: 'sold_out' }),
  ];
  assert.deepEqual(replayStateAt(requests, 20), {
    issued: 2,
    over: 1,
    rejected: 0,
    inflight: 1,
    retries: 2,
    recentRetry: 1,
  });
  assert.deepEqual(replayStateAt(requests, Number.POSITIVE_INFINITY), {
    issued: 3,
    over: 1,
    rejected: 1,
    inflight: 0,
    retries: 4,
    recentRetry: 0,
  });
});
