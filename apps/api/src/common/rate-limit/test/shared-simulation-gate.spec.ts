import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SharedSimulationGate } from '../shared-simulation-gate';

/** 이 게이트가 쓰는 명령만 흉내 낸 Redis. 두 API가 같은 Redis를 보는 상황을 만든다 */
class FakeRedis {
  now = 0;
  down = false;
  private readonly values = new Map<string, { value: string; expiresAt: number }>();

  private read(key: string) {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= this.now) return undefined;
    return entry;
  }

  async set(key: string, value: string, ...options: [string, number, string]) {
    if (this.down) throw new Error('connect ECONNREFUSED');
    if (this.read(key)) return null;
    this.values.set(key, { value, expiresAt: this.now + options[1] }); // 'PX', ttl, 'NX'
    return 'OK';
  }

  async pttl(key: string) {
    const entry = this.read(key);
    return entry ? entry.expiresAt - this.now : -2;
  }

  /** RELEASE(키 1개) / RELEASE_AND_COOL_DOWN(키 2개)만 지원 */
  async eval(_script: string, keyCount: number, ...args: string[]) {
    const [runningKey, ...rest] = args;
    const cooldownKey = keyCount === 2 ? rest.shift() : undefined;
    const [token, cooldownMs] = rest;
    if (this.read(runningKey!)?.value === token) this.values.delete(runningKey!);
    if (cooldownKey && Number(cooldownMs) > 0) {
      this.values.set(cooldownKey, { value: '1', expiresAt: this.now + Number(cooldownMs) });
    }
    return 1;
  }
}

const asRedis = (fake: FakeRedis) =>
  fake as unknown as ConstructorParameters<typeof SharedSimulationGate>[0];

test('API 두 개가 같은 시뮬레이션을 동시에 시작하면 한 쪽만 허용된다', async () => {
  const redis = new FakeRedis();
  const apiOne = new SharedSimulationGate(asRedis(redis), 'coupon', 3_000);
  const apiTwo = new SharedSimulationGate(asRedis(redis), 'coupon', 3_000);

  const first = await apiOne.tryStart();
  const second = await apiTwo.tryStart();

  assert.deepEqual(first.decision, { allowed: true, retryAfterMs: 0 });
  assert.equal(second.decision, 'running');
});

test('끝나면 다른 API에서도 쿨다운이 보이고, 쿨다운이 지나면 다시 허용된다', async () => {
  const redis = new FakeRedis();
  const apiOne = new SharedSimulationGate(asRedis(redis), 'coupon', 3_000);
  const apiTwo = new SharedSimulationGate(asRedis(redis), 'coupon', 3_000);

  await (await apiOne.tryStart()).finish();
  redis.now += 1_000;
  const during = await apiTwo.tryStart();
  assert.deepEqual(during.decision, { allowed: false, retryAfterMs: 2_000 });

  redis.now += 2_000;
  const after = await apiTwo.tryStart();
  assert.deepEqual(after.decision, { allowed: true, retryAfterMs: 0 });
});

test('쿨다운으로 거절된 시도는 실행 잠금을 남기지 않는다', async () => {
  const redis = new FakeRedis();
  const gate = new SharedSimulationGate(asRedis(redis), 'point', 3_000);

  await (await gate.tryStart()).finish();
  await gate.tryStart(); // 쿨다운 중 → 거절
  redis.now += 3_000;

  assert.deepEqual((await gate.tryStart()).decision, { allowed: true, retryAfterMs: 0 });
});

test('장마다 키가 달라서 서로 막지 않는다', async () => {
  const redis = new FakeRedis();
  await new SharedSimulationGate(asRedis(redis), 'coupon', 3_000).tryStart();

  const cache = await new SharedSimulationGate(asRedis(redis), 'cache', 3_000).tryStart();
  assert.deepEqual(cache.decision, { allowed: true, retryAfterMs: 0 });
});

test('Redis가 응답하지 않으면 이 프로세스 안에서만 막는다', async () => {
  const redis = new FakeRedis();
  redis.down = true;
  const gate = new SharedSimulationGate(asRedis(redis), 'coupon', 0);

  const first = await gate.tryStart();
  assert.deepEqual(first.decision, { allowed: true, retryAfterMs: 0 });
  assert.equal((await gate.tryStart()).decision, 'running');

  await first.finish();
  assert.deepEqual((await gate.tryStart()).decision, { allowed: true, retryAfterMs: 0 });
});
