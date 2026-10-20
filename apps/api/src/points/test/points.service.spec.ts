/** 실제 MySQL로 4장 핵심 검증: 통장(ledger) 방식은 동시 요청에도 잔액 = 내역 합계. DB가 없으면 skip (CI는 실패) */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../../prisma/prisma.service';
import { OPENING_BALANCE, PointsService } from '../points.service';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env 없음 → skip
  }
}

describe('point ledger under concurrency (MySQL)', () => {
  const prisma = new PrismaService();
  const ledger = new PointsService(prisma);
  const walletNames = [`test-overwrite-${process.pid}`, `test-ledger-${process.pid}`];
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
    if (dbUp) {
      await prisma.pointEntry.deleteMany({ where: { walletName: { in: walletNames } } });
      await prisma.pointWallet.deleteMany({ where: { name: { in: walletNames } } });
    }
    await prisma.$disconnect();
  });

  test('ledger keeps balance == SUM(entries) and refuses to go below 0', async (testContext) => {
    if (!dbUp) return testContext.skip('DB unavailable');
    const result = await ledger.simulate('ledger', walletNames[1]!, 80);
    // 적립 60 × 100, 사용 20 × 100
    assert.equal(result.expectedBalance, OPENING_BALANCE + 4_000);
    assert.equal(result.reconciliation.balance, result.expectedBalance);
    assert.equal(result.reconciliation.difference, 0);
    assert.equal(result.lostPoints, 0);
    assert.equal(result.overdraft?.rejected, true);
  });

  test('overwrite: reconciliation reports exactly the gap between balance and entries', async (testContext) => {
    if (!dbUp) return testContext.skip('DB unavailable');
    const result = await ledger.simulate('overwrite', walletNames[0]!, 80);
    // 내역은 다 남았으니 합계는 기대 잔액과 같고, 잃어버린 만큼이 차이로 드러난다
    assert.equal(result.reconciliation.entriesSum, result.expectedBalance);
    assert.equal(-result.reconciliation.difference, result.lostPoints);
    assert.equal(result.traces.length, 80);
  });
});
