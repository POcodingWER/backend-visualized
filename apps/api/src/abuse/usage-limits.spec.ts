import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConcurrencyLimit, Cooldown, SlidingWindowLimit } from './usage-limits';

test('SlidingWindowLimit: allows up to the limit, then frees capacity as the window slides', () => {
  let now = 10_000;
  const limit = new SlidingWindowLimit(5, 60_000, () => now);
  assert.equal(limit.tryConsume(3).allowed, true);
  now += 30_000;
  assert.equal(limit.tryConsume(2).allowed, true);
  const rejected = limit.tryConsume(1);
  assert.equal(rejected.allowed, false);
  assert.ok(rejected.retryAfterMs > 0 && rejected.retryAfterMs <= 31_000);
  now += 31_000; // first 3 fall out of the window (1-second buckets)
  assert.equal(limit.usedInWindow, 2);
  assert.equal(limit.tryConsume(3).allowed, true);
});

test('SlidingWindowLimit: limit 0 means unlimited', () => {
  const limit = new SlidingWindowLimit(0, 1_000);
  for (let i = 0; i < 1_000; i++) assert.equal(limit.tryConsume(100).allowed, true);
});

test('Cooldown: rejects until the cooldown passes and can restart from the end of a long task', () => {
  let now = 0;
  const cooldown = new Cooldown(10_000, () => now);
  assert.equal(cooldown.tryStart().allowed, true);
  now = 4_000;
  assert.deepEqual(cooldown.tryStart(), { allowed: false, retryAfterMs: 6_000 });
  now = 9_000;
  cooldown.restartFromNow(); // task finished at 9s → next allowed at 19s
  now = 15_000;
  assert.equal(cooldown.tryStart().allowed, false);
  now = 19_000;
  assert.equal(cooldown.tryStart().allowed, true);
});

test('ConcurrencyLimit: caps active connections and release is idempotent', () => {
  const connections = new ConcurrencyLimit(2);
  const first = connections.tryAcquire();
  const second = connections.tryAcquire();
  assert.ok(first && second);
  assert.equal(connections.tryAcquire(), null);
  first();
  first();
  assert.equal(connections.activeCount, 1);
  assert.ok(connections.tryAcquire());
});
