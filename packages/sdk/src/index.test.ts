import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTracker, type SendInfo } from './index.js';

test('onSend reports batch size/status and flush stays backwards compatible', async () => {
  const calls: unknown[] = [];
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ inserted: 3 }), { status: 202 });
  }) as typeof fetch;
  const infos: SendInfo[] = [];
  const tracker = createTracker({
    endpoint: 'http://x',
    maxBatchSize: 2,
    flushIntervalMs: 60000,
    onSend: (info) => infos.push(info),
  });
  tracker.track('a');
  tracker.track('b'); // size threshold -> auto flush
  tracker.track('c');
  const sent = await tracker.flush();
  await new Promise((resolve) => setTimeout(resolve, 10));
  tracker.destroy();
  assert.equal(sent, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    infos.map((info) => [info.size, info.status, info.ok, info.reason]),
    [
      [2, 202, true, 'size'],
      [1, 202, true, 'manual'],
    ],
  );
});

test('works without onSend and reports 429 as retryable', async () => {
  globalThis.fetch = (async () => new Response('', { status: 429 })) as typeof fetch;
  const infos: SendInfo[] = [];
  const tracker = createTracker({
    endpoint: 'http://x',
    flushIntervalMs: 60000,
    onSend: (info) => infos.push(info),
  });
  tracker.track('a');
  assert.equal(await tracker.flush(), 0);
  tracker.destroy();
  assert.equal(infos[0]?.status, 429);
  assert.equal(infos[0]?.stored, true);
  const t2 = createTracker({ endpoint: 'http://x', flushIntervalMs: 60000 });
  t2.track('a');
  assert.equal(await t2.flush(), 0);
  t2.destroy();
});
