/**
 * 실제 MySQL(DATABASE_URL, apps/api/.env)에 대해 동시성 전략을 검증하는 통합 테스트.
 * DB가 없으면 skip.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { CouponStrategies, type Strategy } from './coupon-strategies';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env 없음 → skip
  }
}

const USERS = 300;
const QUANTITY = 50;

describe('coupon strategies under concurrency (MySQL)', () => {
  const prisma = new PrismaClient();
  const sampler = new PrismaClient();
  const strategies = new CouponStrategies(prisma, sampler);
  let dbUp = false;

  before(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbUp = true;
    } catch (error) {
      // CI(REQUIRE_DATABASE=true)에선 DB가 없으면 skip하지 말고 실패
      if (process.env.REQUIRE_DATABASE === 'true') throw error;
      dbUp = false;
    }
  });
  after(async () => {
    if (dbUp) await prisma.coupon.deleteMany({ where: { name: { startsWith: 'test-' } } });
    await prisma.$disconnect();
    await sampler.$disconnect();
  });

  test('none: read-then-write oversells (race condition)', async (testContext) => {
    if (!dbUp) return testContext.skip('DB unavailable');
    const result = await strategies.simulate('none', USERS, QUANTITY, 'test-none');
    assert.ok(
      result.final.issueRows > QUANTITY,
      `expected oversell, rows=${result.final.issueRows}`,
    );
    assert.ok(result.final.oversold > 0);
    assert.equal(
      result.requests.filter((request) => request.oversold).length,
      result.final.oversold,
    );
    // lost update: 카운터가 실제 발급 행 수보다 작다
    assert.ok(result.final.counterMismatch);
    assert.ok(result.final.issuedCount < result.final.issueRows);
    assert.ok(result.dbSnapshots.length >= 2);
  });

  for (const strategy of ['pessimistic', 'optimistic', 'atomic'] as Strategy[]) {
    test(`${strategy}: issues exactly quantity, never oversells`, async (testContext) => {
      if (!dbUp) return testContext.skip('DB unavailable');
      const result = await strategies.simulate(strategy, USERS, QUANTITY, `test-${strategy}`);
      assert.equal(result.final.oversold, 0);
      assert.equal(result.final.issueRows, QUANTITY);
      assert.equal(result.final.issuedCount, QUANTITY);
      assert.equal(result.final.counterMismatch, false);
      assert.equal(result.summary.error, 0);
      assert.equal(
        result.summary.issued + result.summary.sold_out + result.summary.retry_exhausted,
        USERS,
      );
      assert.equal(result.requests.length, USERS);
      const first = result.requests[0]!;
      assert.equal(typeof first.userId, 'string');
      assert.ok(first.finishedAtMs >= first.startedAtMs);
      // DB 스냅샷: 실제 행 수는 줄어들지 않고, 최종값은 QTY
      for (let i = 1; i < result.dbSnapshots.length; i++) {
        assert.ok(result.dbSnapshots[i]!.issueRows >= result.dbSnapshots[i - 1]!.issueRows);
      }
      assert.equal(result.dbSnapshots.at(-1)!.issueRows, QUANTITY);
      if (strategy === 'optimistic')
        assert.ok(result.summary.totalRetries > 0, 'expected version conflicts');
      if (strategy === 'atomic') {
        assert.ok(
          result.requests
            .filter((request) => request.result === 'sold_out')
            .every((request) => request.affectedRows === 0),
        );
      }
      if (strategy === 'pessimistic') {
        assert.ok(result.requests.every((request) => typeof request.lockWaitMs === 'number'));
      }
    });
  }
});
