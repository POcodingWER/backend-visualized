import type { PrismaClient } from '@prisma/client';

export const STRATEGIES = ['none', 'pessimistic', 'optimistic', 'atomic'] as const;
export type Strategy = (typeof STRATEGIES)[number];

export interface IssueResult {
  ok: boolean;
  /** issued | sold_out | conflict(낙관적 락 재시도 초과) | error */
  reason: 'issued' | 'sold_out' | 'conflict' | 'error';
  /** 낙관적 락 재시도 횟수 */
  retries: number;
}

export interface TimelineEntry {
  /** 요청 시작/종료 (시뮬레이션 시작 기준 ms) */
  s: number;
  e: number;
  ok: boolean;
  r: number;
  /** 성공 순번이 totalQuantity를 넘긴 초과 발급 */
  o: boolean;
  reason: IssueResult['reason'];
}

export interface SimulationResult {
  strategy: Strategy;
  users: number;
  quantity: number;
  /** CouponIssue 실제 행 수 */
  issued: number;
  /** Coupon.issuedCount 카운터 값 (lost update 시 issued와 어긋남) */
  counter: number;
  oversold: number;
  soldOut: number;
  conflicts: number;
  errors: number;
  retries: number;
  durationMs: number;
  timeline: TimelineEntry[];
}

const OPTIMISTIC_MAX_RETRIES = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 선착순 쿠폰 발급 전략 4종. NestJS 의존성 없이 PrismaClient만 받아 테스트/벤치에서도 재사용.
 */
export class CouponStrategies {
  constructor(private readonly db: PrismaClient) {}

  async reset(name: string, quantity: number) {
    return this.db.$transaction(async (tx) => {
      const c = await tx.coupon.upsert({
        where: { name },
        create: { name, totalQuantity: quantity },
        update: { totalQuantity: quantity, issuedCount: 0, version: 0 },
      });
      await tx.couponIssue.deleteMany({ where: { couponId: c.id } });
      return c;
    });
  }

  async couponId(name: string): Promise<number | null> {
    const c = await this.db.coupon.findUnique({ where: { name }, select: { id: true } });
    return c?.id ?? null;
  }

  async state(name: string) {
    const c = await this.db.coupon.findUnique({ where: { name } });
    if (!c) return null;
    const issued = await this.db.couponIssue.count({ where: { couponId: c.id } });
    return {
      name: c.name,
      totalQuantity: c.totalQuantity,
      counter: c.issuedCount,
      issued,
      oversold: Math.max(0, issued - c.totalQuantity),
    };
  }

  async issue(strategy: Strategy, couponId: number, userId: string): Promise<IssueResult> {
    try {
      switch (strategy) {
        case 'none':
          return await this.none(couponId, userId);
        case 'pessimistic':
          return await this.pessimistic(couponId, userId);
        case 'optimistic':
          return await this.optimistic(couponId, userId);
        case 'atomic':
          return await this.atomic(couponId, userId);
      }
    } catch {
      return { ok: false, reason: 'error', retries: 0 };
    }
  }

  /** 읽고 → 판단하고 → 쓰기. 읽기와 쓰기 사이에 다른 요청이 끼어들면 초과 발급 + lost update */
  private async none(couponId: number, userId: string): Promise<IssueResult> {
    const c = await this.db.coupon.findUniqueOrThrow({ where: { id: couponId } });
    if (c.issuedCount >= c.totalQuantity) return { ok: false, reason: 'sold_out', retries: 0 };
    await this.db.couponIssue.create({ data: { couponId, userId, strategy: 'none' } });
    await this.db.coupon.update({
      where: { id: couponId },
      data: { issuedCount: c.issuedCount + 1 },
    });
    return { ok: true, reason: 'issued', retries: 0 };
  }

  /** SELECT ... FOR UPDATE: 행 락을 잡은 트랜잭션만 진행, 나머지는 줄을 서서 대기 */
  private async pessimistic(couponId: number, userId: string): Promise<IssueResult> {
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ issuedCount: number; totalQuantity: number }[]>`
          SELECT issuedCount, totalQuantity FROM Coupon WHERE id = ${couponId} FOR UPDATE`;
        const c = rows[0];
        if (!c || c.issuedCount >= c.totalQuantity) {
          return { ok: false, reason: 'sold_out', retries: 0 } as IssueResult;
        }
        await tx.couponIssue.create({ data: { couponId, userId, strategy: 'pessimistic' } });
        await tx.coupon.update({
          where: { id: couponId },
          data: { issuedCount: { increment: 1 } },
        });
        return { ok: true, reason: 'issued', retries: 0 } as IssueResult;
      },
      { maxWait: 60_000, timeout: 60_000 },
    );
  }

  /** version 비교 후 갱신(CAS). 누가 먼저 바꿨으면 0행 갱신 → 다시 읽고 재시도 */
  private async optimistic(couponId: number, userId: string): Promise<IssueResult> {
    for (let retries = 0; retries <= OPTIMISTIC_MAX_RETRIES; retries++) {
      const c = await this.db.coupon.findUniqueOrThrow({ where: { id: couponId } });
      if (c.issuedCount >= c.totalQuantity) return { ok: false, reason: 'sold_out', retries };
      const { count } = await this.db.coupon.updateMany({
        where: { id: couponId, version: c.version },
        data: { issuedCount: { increment: 1 }, version: { increment: 1 } },
      });
      if (count === 1) {
        await this.db.couponIssue.create({ data: { couponId, userId, strategy: 'optimistic' } });
        return { ok: true, reason: 'issued', retries };
      }
      // 충돌: 짧은 랜덤 백오프 후 재시도 (동시에 재시도해서 또 부딪히는 것 완화)
      await sleep(Math.random() * 5 * (retries + 1));
    }
    return { ok: false, reason: 'conflict', retries: OPTIMISTIC_MAX_RETRIES };
  }

  /** 조건부 원자적 UPDATE 한 문장: 판단과 증가를 DB가 한 번에 처리 */
  private async atomic(couponId: number, userId: string): Promise<IssueResult> {
    const affected = await this.db.$executeRaw`
      UPDATE Coupon SET issuedCount = issuedCount + 1
      WHERE id = ${couponId} AND issuedCount < totalQuantity`;
    if (affected !== 1) return { ok: false, reason: 'sold_out', retries: 0 };
    await this.db.couponIssue.create({ data: { couponId, userId, strategy: 'atomic' } });
    return { ok: true, reason: 'issued', retries: 0 };
  }

  /** users명이 동시에 quantity개 쿠폰에 몰리는 상황을 서버 내부에서 재현 */
  async simulate(strategy: Strategy, users: number, quantity: number, name = `sim-${strategy}`) {
    const coupon = await this.reset(name, quantity);
    const t0 = performance.now();
    let successSeq = 0;
    const timeline: TimelineEntry[] = await Promise.all(
      Array.from({ length: users }, async (_, i) => {
        const s = performance.now() - t0;
        const r = await this.issue(strategy, coupon.id, `user-${i}`);
        const e = performance.now() - t0;
        const o = r.ok && ++successSeq > quantity;
        return { s: round(s), e: round(e), ok: r.ok, r: r.retries, o, reason: r.reason };
      }),
    );
    const durationMs = round(performance.now() - t0);
    const st = await this.state(name);
    const count = (reason: IssueResult['reason']) =>
      timeline.filter((t) => t.reason === reason).length;
    return {
      strategy,
      users,
      quantity,
      issued: st?.issued ?? 0,
      counter: st?.counter ?? 0,
      oversold: st?.oversold ?? 0,
      soldOut: count('sold_out'),
      conflicts: count('conflict'),
      errors: count('error'),
      retries: timeline.reduce((a, t) => a + t.r, 0),
      durationMs,
      timeline: timeline.sort((a, b) => a.e - b.e),
    } satisfies SimulationResult;
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
