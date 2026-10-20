import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { runSimulation } from './api';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const respondWith = (status: number, body: unknown) => {
  globalThis.fetch = (async () => Response.json(body, { status })) as typeof fetch;
};
const run = () => runSimulation({ users: 10, quantity: 1 });

test('쿨다운 429면 남은 초를 넣어 안내한다', async () => {
  respondWith(429, { reason: 'simulation_cooldown', retryAfterSeconds: 7 });
  await assert.rejects(run(), /7초 뒤에 다시/);
});

test('다른 이유의 429는 "너무 자주"로 안내한다', async () => {
  respondWith(429, { reason: 'too_many_requests' });
  await assert.rejects(run(), /너무 자주 눌렀어요/);
});

test('409는 다른 사람이 실행 중이라고 안내한다', async () => {
  respondWith(409, {});
  await assert.rejects(run(), /다른 사람이 실험을 돌리고/);
});

test('성공이면 results만 돌려준다', async () => {
  respondWith(201, { results: [{ strategy: 'atomic' }] });
  assert.deepEqual(await run(), [{ strategy: 'atomic' }]);
});
