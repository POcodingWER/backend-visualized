/** 실제 MySQL로 5장 핵심 검증: 같은 Idempotency-Key로 동시에 5번 → 결제 1건, 응답은 모두 같은 결제 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService, STALE_PROCESSING_MS } from '../payments.service';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env 없음 → skip
  }
}

describe('idempotent payments under concurrency (MySQL)', () => {
  const prisma = new PrismaService();
  const desk = new PaymentsService(prisma);
  desk.gatewayDelayMs = 150;
  const orderIds = [
    `order-test-key-${process.pid}`,
    `order-test-nokey-${process.pid}`,
    `order-test-stale-${process.pid}`,
  ];
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

  test('processing으로 남은 결제: 5분 지나면 failed, 두 번 돌려도 한 번만 바뀐다', async (testContext) => {
    if (!dbUp) return testContext.skip('DB unavailable');
    const orderId = orderIds[2]!;
    const now = Date.now();
    const key = `test-stale-${process.pid}-${now}`;
    // PG 호출 중에 죽은 첫 요청 흉내: 6분 전에 만든 processing 행 + 방금 만든 processing 행
    const stale = await prisma.payment.create({
      data: {
        orderId,
        amount: 12_000,
        status: 'processing',
        idempotencyKey: key,
        createdAt: new Date(now - STALE_PROCESSING_MS - 60_000),
      },
    });
    const fresh = await prisma.payment.create({
      data: { orderId, amount: 12_000, status: 'processing' },
    });
    const cutoff = new Date(now - STALE_PROCESSING_MS);
    // blue/green 두 컨테이너가 같은 순간에 정리 잡을 돌린 상황
    const counts = await Promise.all([
      desk.failStaleProcessing(cutoff),
      desk.failStaleProcessing(cutoff),
    ]);
    const mine = await prisma.payment.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
    assert.equal(mine.find((row) => row.id === stale.id)?.status, 'failed');
    assert.equal(
      mine.find((row) => row.id === fresh.id)?.status,
      'processing',
      '아직 5분 안 된 건 그대로',
    );
    // 다른 테스트의 행이 섞일 수 있어 합계는 "최소 1, 내 행은 한 번만"으로 본다
    assert.ok(counts[0]! + counts[1]! >= 1);
    assert.equal(await desk.failStaleProcessing(cutoff), 0, '다시 돌려도 바뀔 것이 없다');
    // 같은 키로 다시 보내면 기다리지 않고 바로 "새 키로" 안내
    assert.equal((await desk.pay(orderId, 12_000, key)).kind, 'previous_attempt_failed');
  });
});
