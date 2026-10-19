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
  const sampler = new PrismaClient();
  const s = new CouponStrategies(db, sampler);
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
    await sampler.$disconnect();
  });

  test('none: read-then-write oversells (race condition)', async (t) => {
    if (!dbUp) return t.skip('DB unavailable');
    const r = await s.simulate('none', USERS, QTY, 'test-none');
    assert.ok(r.final.issueRows > QTY, `expected oversell, rows=${r.final.issueRows}`);
    assert.ok(r.final.oversold > 0);
    assert.equal(r.requests.filter((x) => x.oversold).length, r.final.oversold);
    // lost update: 카운터가 실제 발급 행 수보다 작다
    assert.ok(r.final.counterMismatch);
    assert.ok(r.final.issuedCount < r.final.issueRows);
    assert.ok(r.dbSnapshots.length >= 2);
  });

  for (const strategy of ['pessimistic', 'optimistic', 'atomic'] as Strategy[]) {
    test(`${strategy}: issues exactly quantity, never oversells`, async (t) => {
      if (!dbUp) return t.skip('DB unavailable');
      const r = await s.simulate(strategy, USERS, QTY, `test-${strategy}`);
      assert.equal(r.final.oversold, 0);
      assert.equal(r.final.issueRows, QTY);
      assert.equal(r.final.issuedCount, QTY);
      assert.equal(r.final.counterMismatch, false);
      assert.equal(r.summary.error, 0);
      assert.equal(r.summary.issued + r.summary.sold_out + r.summary.retry_exhausted, USERS);
      assert.equal(r.requests.length, USERS);
      const first = r.requests[0]!;
      assert.equal(typeof first.userId, 'string');
      assert.ok(first.finishedAtMs >= first.startedAtMs);
      // DB 스냅샷: 실제 행 수는 줄어들지 않고, 최종값은 QTY
      for (let i = 1; i < r.dbSnapshots.length; i++) {
        assert.ok(r.dbSnapshots[i]!.issueRows >= r.dbSnapshots[i - 1]!.issueRows);
      }
      assert.equal(r.dbSnapshots.at(-1)!.issueRows, QTY);
      if (strategy === 'optimistic')
        assert.ok(r.summary.totalRetries > 0, 'expected version conflicts');
      if (strategy === 'atomic') {
        assert.ok(
          r.requests.filter((x) => x.result === 'sold_out').every((x) => x.affectedRows === 0),
        );
      }
      if (strategy === 'pessimistic') {
        assert.ok(r.requests.every((x) => typeof x.lockWaitMs === 'number'));
      }
    });
  }
});
