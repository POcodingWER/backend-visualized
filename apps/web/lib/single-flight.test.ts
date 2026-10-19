import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSingleFlight } from './single-flight';

test('concurrent callers share one in-flight task', async () => {
  let calls = 0;
  const refresh = createSingleFlight(async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return `token-${calls}`;
  });
  const results = await Promise.all(Array.from({ length: 5 }, () => refresh()));
  assert.equal(calls, 1);
  assert.deepEqual(results, Array(5).fill('token-1'));
});

test('a new call after completion starts a new task', async () => {
  let calls = 0;
  const refresh = createSingleFlight(async () => ++calls);
  assert.equal(await refresh(), 1);
  assert.equal(await refresh(), 2);
});

test('failure is shared by waiting callers and does not stick', async () => {
  let calls = 0;
  const refresh = createSingleFlight(async () => {
    calls++;
    if (calls === 1) throw new Error('refresh failed');
    return 'ok';
  });
  const settled = await Promise.allSettled([refresh(), refresh(), refresh()]);
  assert.ok(settled.every((result) => result.status === 'rejected'));
  assert.equal(calls, 1);
  assert.equal(await refresh(), 'ok');
});
