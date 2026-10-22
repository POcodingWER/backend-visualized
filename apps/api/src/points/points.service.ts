import { Injectable } from '@nestjs/common';
import { startStopwatch } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';

/** overwrite: 잔액을 읽고 → 계산해서 → 덮어쓰기 / ledger: 잠금 + 내역 추가 + 잔액 증가를 한 트랜잭션으로 */
export const POINT_MODES = ['overwrite', 'ledger'] as const;
export type PointMode = (typeof POINT_MODES)[number];

/** 방식마다 지갑 하나 (데모용 고정 이름) */
const WALLET_BY_MODE: Record<PointMode, string> = {
  overwrite: 'sim-overwrite',
  ledger: 'sim-ledger',
};

export const OPENING_BALANCE = 5_000;
const POINTS_PER_REQUEST = 100;

/** 요청 하나가 언제 잔액을 읽고 언제 썼는지 (시뮬레이션 시작 기준 ms) */
export interface PointRequestTrace {
  amount: number;
  startedAtMs: number;
  readAtMs: number;
  wroteAtMs: number;
  balanceSeen: number;
  balanceWritten: number;
  outcome: 'applied' | 'rejected';
}

export interface Reconciliation {
  balance: number;
  entriesSum: number;
  /** balance - entriesSum. 0이 아니면 장부와 잔액이 어긋난 것 */
  difference: number;
}

export interface PointSimulationResult {
  mode: PointMode;
  walletName: string;
  requests: number;
  openingBalance: number;
  expectedBalance: number;
  reconciliation: Reconciliation;
  /** 기대 잔액 - 실제 잔액 (사라진 포인트) */
  lostPoints: number;
  rejected: number;
  durationMs: number;
  traces: PointRequestTrace[];
  /** ledger만: 잔액보다 큰 금액을 쓰려 하면 거절되는지 */
  overdraft?: { attemptedAmount: number; rejected: boolean };
}

/** 적립 3 : 사용 1. 시작 잔액이 충분해서 정상이라면 거절되는 요청은 없다 */
export const amountForRequest = (index: number) =>
  index % 4 === 3 ? -POINTS_PER_REQUEST : POINTS_PER_REQUEST;

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 지갑을 시작 잔액으로 되돌리고 내역도 '시작 잔액' 한 줄만 남긴다 */
  async reset(walletName: string) {
    await this.prisma.$transaction([
      this.prisma.pointEntry.deleteMany({ where: { walletName } }),
      this.prisma.pointEntry.create({
        data: { walletName, amount: OPENING_BALANCE, reason: 'opening' },
      }),
      this.prisma.pointWallet.upsert({
        where: { name: walletName },
        create: { name: walletName, balance: OPENING_BALANCE },
        update: { balance: OPENING_BALANCE },
      }),
    ]);
  }

  /** 대사(reconciliation): 잔액 칸 vs 내역 합계 */
  async reconcile(walletName: string): Promise<Reconciliation> {
    const [wallet, sum] = await Promise.all([
      this.prisma.pointWallet.findUniqueOrThrow({ where: { name: walletName } }),
      this.prisma.pointEntry.aggregate({ where: { walletName }, _sum: { amount: true } }),
    ]);
    const entriesSum = sum._sum.amount ?? 0;
    return { balance: wallet.balance, entriesSum, difference: wallet.balance - entriesSum };
  }

  /** 흔한 실수: 읽은 잔액에 더해서 덮어쓴다. 내역은 따로 남기지만 잔액 칸은 마지막에 쓴 사람이 이긴다 */
  async applyByOverwrite(walletName: string, amount: number, clock: () => number) {
    const wallet = await this.prisma.pointWallet.findUniqueOrThrow({ where: { name: walletName } });
    const readAtMs = clock();
    if (wallet.balance + amount < 0)
      return { readAtMs, wroteAtMs: clock(), balanceSeen: wallet.balance, applied: false };
    await this.prisma.pointEntry.create({ data: { walletName, amount, reason: reasonOf(amount) } });
    await this.prisma.pointWallet.update({
      where: { name: walletName },
      data: { balance: wallet.balance + amount },
    });
    return { readAtMs, wroteAtMs: clock(), balanceSeen: wallet.balance, applied: true };
  }

  /** 통장 방식: 지갑 행을 잠그고(FOR UPDATE) 0 미만 검사 → 내역 추가 → 잔액 += amount 를 한 트랜잭션으로 */
  async applyByLedger(walletName: string, amount: number, clock: () => number) {
    return this.prisma.$transaction(
      async (transaction) => {
        const [wallet] = await transaction.$queryRaw<{ balance: number }[]>`
          SELECT balance FROM PointWallet WHERE name = ${walletName} FOR UPDATE`;
        const balanceSeen = Number(wallet!.balance);
        const readAtMs = clock();
        if (balanceSeen + amount < 0)
          return { readAtMs, wroteAtMs: clock(), balanceSeen, applied: false };
        await transaction.pointEntry.create({
          data: { walletName, amount, reason: reasonOf(amount) },
        });
        await transaction.pointWallet.update({
          where: { name: walletName },
          data: { balance: { increment: amount } },
        });
        return { readAtMs, wroteAtMs: clock(), balanceSeen, applied: true };
      },
      // 요청 수백 개가 같은 행 잠금을 기다리므로 기본(2초/5초)보다 넉넉하게
      { maxWait: 15_000, timeout: 15_000 },
    );
  }

  async simulate(mode: PointMode, walletName: string, requests: number) {
    await this.reset(walletName);
    const clock = startStopwatch();
    const apply = mode === 'overwrite' ? this.applyByOverwrite : this.applyByLedger;
    const traces = await Promise.all(
      Array.from({ length: requests }, async (_, index): Promise<PointRequestTrace> => {
        const amount = amountForRequest(index);
        const startedAtMs = clock();
        const step = await apply.call(this, walletName, amount, clock);
        return {
          amount,
          startedAtMs,
          readAtMs: step.readAtMs,
          wroteAtMs: step.wroteAtMs,
          balanceSeen: step.balanceSeen,
          balanceWritten: step.applied ? step.balanceSeen + amount : step.balanceSeen,
          outcome: step.applied ? 'applied' : 'rejected',
        };
      }),
    );
    const durationMs = clock();
    const expectedBalance =
      OPENING_BALANCE +
      traces.filter((trace) => trace.outcome === 'applied').reduce((sum, t) => sum + t.amount, 0);
    const reconciliation = await this.reconcile(walletName);
    const result: PointSimulationResult = {
      mode,
      walletName,
      requests,
      openingBalance: OPENING_BALANCE,
      expectedBalance,
      reconciliation,
      lostPoints: expectedBalance - reconciliation.balance,
      rejected: traces.filter((trace) => trace.outcome === 'rejected').length,
      durationMs,
      traces,
    };
    if (mode === 'ledger') {
      const attemptedAmount = reconciliation.balance + POINTS_PER_REQUEST;
      const step = await this.applyByLedger(walletName, -attemptedAmount, clock);
      result.overdraft = { attemptedAmount, rejected: !step.applied };
    }
    return result;
  }

  /** 같은 요청 수로 두 방식을 차례로 (동시에 돌리면 서로의 DB 부하가 섞인다) */
  async simulateBothModes(requests: number) {
    const results: PointSimulationResult[] = [];
    for (const mode of POINT_MODES)
      results.push(await this.simulate(mode, WALLET_BY_MODE[mode], requests));
    return results;
  }

  /** 개발자용 화면: 지갑 잔액 칸, 내역 합계, 최근 내역 행 (아직 실행 전이면 reconciliation은 null) */
  async entriesFor(mode: PointMode, limit: number) {
    const walletName = WALLET_BY_MODE[mode];
    const [reconciliation, entries] = await Promise.all([
      this.reconcile(walletName).catch(() => null),
      this.recentEntries(walletName, limit),
    ]);
    // id는 BigInt라 JSON으로 못 보낸다 → 문자열
    return {
      walletName,
      reconciliation,
      entries: entries.map((entry) => ({ ...entry, id: entry.id.toString() })),
    };
  }

  recentEntries(walletName: string, take: number) {
    return this.prisma.pointEntry.findMany({
      where: { walletName },
      orderBy: { id: 'desc' },
      take,
      select: { id: true, amount: true, reason: true, createdAt: true },
    });
  }
}

const reasonOf = (amount: number) => (amount >= 0 ? 'earn' : 'spend');
