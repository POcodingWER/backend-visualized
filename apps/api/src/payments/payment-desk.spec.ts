/** 실제 MySQL로 5장 핵심 검증: 같은 Idempotency-Key로 동시에 5번 → 결제 1건, 응답은 모두 같은 결제 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PaymentDesk } from './payment-desk';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env 없음 → skip
  }
}

describe('idempotent payments under concurrency (MySQL)', () => {
  const prisma = new PrismaClient();
  const desk = new PaymentDesk(prisma, 150);
  const orderIds = [`order-test-key-${process.pid}`, `order-test-nokey-${process.pid}`];
  let dbUp = false;

  before(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbUp = true;
    } catch (error) {
      if (process.env.REQUIRE_DATABASE === 'true') throw error;
    }
  });
  after(async () => {
    if (dbUp) await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.$disconnect();
  });

  test('same key x5 at once → one row, every response is the same payment', async (testContext) => {
    if (!dbUp) return testContext.skip('DB unavailable');
    const key = `test-key-${process.pid}-${Date.now()}`;
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => desk.pay(orderIds[0]!, 12_000, key)),
    );
    assert.equal(outcomes.filter((outcome) => outcome.kind === 'charged').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.kind === 'replayed').length, 4);
    const ids = new Set(outcomes.map((outcome) => ('payment' in outcome ? outcome.payment.id : 0)));
    assert.equal(ids.size, 1);
    assert.equal((await desk.listByOrder(orderIds[0]!)).length, 1);
    // 같은 키로 금액만 바꿔 보내면 거절
    assert.equal(
      (await desk.pay(orderIds[0]!, 99_000, key)).kind,
      'key_reused_for_different_request',
    );
  });

  test('no key x5 at once → five charges', async (testContext) => {
    if (!dbUp) return testContext.skip('DB unavailable');
    await Promise.all(Array.from({ length: 5 }, () => desk.pay(orderIds[1]!, 12_000)));
    assert.equal((await desk.listByOrder(orderIds[1]!)).length, 5);
  });
});
