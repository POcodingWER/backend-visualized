import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { callApi, CONNECTION_FAILED, FriendlyError, requireOk } from './api';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** fetch를 가짜로 바꾸고, 받은 요청을 기록한다 */
function fakeFetch(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as typeof fetch;
  return calls;
}

test('json을 주면 POST + JSON 본문 + Content-Type으로 보낸다', async () => {
  const calls = fakeFetch(() => Response.json({ ok: 1 }));
  const result = await callApi<{ ok: number }>('/points/simulate', { json: { requests: 2 } });
  assert.equal(calls[0].url, 'http://localhost:4000/points/simulate');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{"requests":2}');
  assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(result.body, { ok: 1 });
});

test('4xx는 던지지 않고 status와 body를 돌려준다 (문장은 장마다 고른다)', async () => {
  fakeFetch(() => Response.json({ reason: 'simulation_cooldown' }, { status: 429 }));
  const result = await callApi<{ reason: string }>('/coupons/simulate', { json: {} });
  assert.equal(result.status, 429);
  assert.equal(result.ok, false);
  assert.equal(result.body.reason, 'simulation_cooldown');
});

test('서버에 닿지 못하면 쉬운 문장의 FriendlyError', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  await assert.rejects(callApi('/events/stats'), (error: unknown) => {
    assert.ok(error instanceof FriendlyError);
    assert.equal(error.message, CONNECTION_FAILED);
    return true;
  });
});

test('requireOk: 실패 응답이면 상태 코드를 담은 FriendlyError', async () => {
  fakeFetch(() => new Response('oops', { status: 500 }));
  await assert.rejects(requireOk(callApi('/payments?orderId=x')), /서버 오류 \(500\)/);
});
