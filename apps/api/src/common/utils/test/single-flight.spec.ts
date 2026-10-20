import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSingleFlight } from '../single-flight';

test('concurrent callers share one run, the next call starts a new one', async () => {
  let runs = 0;
  const load = createSingleFlight(async () => {
    runs++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return runs;
  });
  const results = await Promise.all([load(), load(), load()]);
  assert.deepEqual(results, [1, 1, 1]);
  assert.equal(await load(), 2);
});

test('a failure reaches every waiting caller and does not stick', async () => {
  let shouldFail = true;
  const load = createSingleFlight(async () => {
    if (shouldFail) throw new Error('boom');
    return 'ok';
  });
  const settled = await Promise.allSettled([load(), load()]);
  assert.deepEqual(
    settled.map((result) => result.status),
    ['rejected', 'rejected'],
  );
  shouldFail = false;
  assert.equal(await load(), 'ok');
});
