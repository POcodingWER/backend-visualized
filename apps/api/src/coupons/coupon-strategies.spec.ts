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
const QTY = 50;

describe('coupon strategies under concurrency (MySQL)', () => {
  const db = new PrismaClient();
  const s = new CouponStrategies(db);
  let dbUp = false;

  before(async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });
  after(async () => {
    if (dbUp) await db.coupon.deleteMany({ where: { name: { startsWith: 'test-' } } });
    await db.$disconnect();
  });

  test('none: read-then-write oversells (race condition)', async (t) => {
    if (!dbUp) return t.skip('DB unavailable');
    const r = await s.simulate('none', USERS, QTY, 'test-none');
    assert.ok(r.issued > QTY, `expected oversell, issued=${r.issued}`);
    assert.ok(r.oversold > 0);
    // lost update: 카운터가 실제 발급 수보다 작다
    assert.ok(r.counter < r.issued, `counter=${r.counter} issued=${r.issued}`);
  });

  for (const strategy of ['pessimistic', 'optimistic', 'atomic'] as Strategy[]) {
    test(`${strategy}: issues exactly quantity, never oversells`, async (t) => {
      if (!dbUp) return t.skip('DB unavailable');
      const r = await s.simulate(strategy, USERS, QTY, `test-${strategy}`);
      assert.equal(r.oversold, 0);
      assert.equal(r.issued, QTY);
      assert.equal(r.counter, QTY);
      assert.equal(r.errors, 0);
      assert.equal(r.issued + r.soldOut + r.conflicts, USERS);
      if (strategy === 'optimistic') assert.ok(r.retries > 0, 'expected version conflicts');
    });
  }
});
