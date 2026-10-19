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
  const t = createTracker({
    endpoint: 'http://x',
    maxBatchSize: 2,
    flushIntervalMs: 60000,
    onSend: (i) => infos.push(i),
  });
  t.track('a');
  t.track('b'); // size threshold -> auto flush
  t.track('c');
  const sent = await t.flush();
  await new Promise((r) => setTimeout(r, 10));
  t.destroy();
  assert.equal(sent, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    infos.map((i) => [i.size, i.status, i.ok, i.reason]),
    [
      [2, 202, true, 'size'],
      [1, 202, true, 'manual'],
    ],
  );
});

test('works without onSend and reports 429 as retryable', async () => {
  globalThis.fetch = (async () => new Response('', { status: 429 })) as typeof fetch;
  const infos: SendInfo[] = [];
  const t = createTracker({
    endpoint: 'http://x',
    flushIntervalMs: 60000,
    onSend: (i) => infos.push(i),
  });
  t.track('a');
  assert.equal(await t.flush(), 0);
  t.destroy();
  assert.equal(infos[0]?.status, 429);
  assert.equal(infos[0]?.stored, true);
  const t2 = createTracker({ endpoint: 'http://x', flushIntervalMs: 60000 });
  t2.track('a');
  assert.equal(await t2.flush(), 0);
  t2.destroy();
});
