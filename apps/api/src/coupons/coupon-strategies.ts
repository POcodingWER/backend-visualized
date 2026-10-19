import type { PrismaClient } from '@prisma/client';

export const STRATEGIES = ['none', 'pessimistic', 'optimistic', 'atomic'] as const;
export type Strategy = (typeof STRATEGIES)[number];

export type IssueOutcome = 'issued' | 'sold_out' | 'retry_exhausted' | 'error';

export interface IssueResult {
  success: boolean;
  result: IssueOutcome;
  /** 낙관적 락: version 충돌로 다시 시도한 횟수 */
  retries: number;
  /** 생성된 CouponIssue.id (성공 시) */
  issueRowId?: string;
  /** 비관적 락: 트랜잭션 커넥션 획득까지 대기(ms) — 커넥션 풀 대기 */
  poolWaitMs?: number;
  /** 비관적 락: SELECT … FOR UPDATE가 행 락을 얻기까지 대기(ms) */
  lockWaitMs?: number;
  /** 원자적 UPDATE: 조건부 UPDATE가 바꾼 행 수 (0이면 품절로 거절) */
  affectedRows?: number;
  /** 제어 없음: 이 요청이 읽은 issuedCount (모두 같은 값을 읽으면 초과 발급) */
  readIssuedCount?: number;
  errorMessage?: string;
}

export interface RequestTrace extends IssueResult {
  requestId: number;
  userId: string;
  /** 시뮬레이션 시작 기준 ms */
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  /** 성공 순번 (완료 순) */
  issueSeq?: number;
  /** 성공했지만 순번이 totalQuantity를 넘은 초과 발급 */
  oversold: boolean;
}

/** 시뮬레이션 중 별도 커넥션으로 주기적으로 읽은 실제 DB 상태 */
export interface DbSnapshot {
  atMs: number;
  /** Coupon.issuedCount (카운터 컬럼) */
  issuedCount: number;
  version: number;
  /** COUNT(*) FROM CouponIssue (실제 발급 행) */
  issueRows: number;
}

export interface SimulationResult {
  strategy: Strategy;
  couponName: string;
  couponId: number;
  users: number;
  quantity: number;
  durationMs: number;
  /** 종료 후 DB에서 다시 읽은 최종 상태 */
  final: {
    issueRows: number;
    issuedCount: number;
    version: number;
    oversold: number;
    counterMismatch: boolean;
  };
  summary: Record<IssueOutcome, number> & { totalRetries: number };
  dbSnapshots: DbSnapshot[];
  requests: RequestTrace[];
}

const OPTIMISTIC_MAX_RETRIES = 30;
const SNAPSHOT_EVERY_MS = 25;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * 선착순 쿠폰 발급 전략 4종. NestJS 의존성 없이 PrismaClient만 받아 테스트/벤치에서도 재사용.
 * sampler: DB 스냅샷용 별도 클라이언트(커넥션 풀 경합 없이 관찰). 없으면 db 사용.
 */
export class CouponStrategies {
  constructor(
    private readonly db: PrismaClient,
    private readonly sampler: PrismaClient = db,
  ) {}

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

  /** 실제 DB 상태(진실 확인용): Coupon 행 + 발급 행 수 + 최근 발급 행 */
  async dbState(name: string, limit = 20, offset = 0) {
    const coupon = await this.db.coupon.findUnique({ where: { name } });
    if (!coupon) return null;
    const [issueRows, rows] = await Promise.all([
      this.db.couponIssue.count({ where: { couponId: coupon.id } }),
      this.db.couponIssue.findMany({
        where: { couponId: coupon.id },
        orderBy: { id: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);
    // 오래된 순 번호: id 오름차순 순위가 totalQuantity를 넘으면 초과 발급 행
    return {
      coupon: {
        id: coupon.id,
        name: coupon.name,
        totalQuantity: coupon.totalQuantity,
        issuedCount: coupon.issuedCount,
        version: coupon.version,
        updatedAt: coupon.updatedAt,
      },
      issueRows,
      oversold: Math.max(0, issueRows - coupon.totalQuantity),
      counterMismatch: coupon.issuedCount !== issueRows,
      recentIssues: rows.map((r, i) => {
        const rank = issueRows - offset - i;
        return {
          id: r.id.toString(),
          userId: r.userId,
          strategy: r.strategy,
          createdAt: r.createdAt,
          rank,
          oversold: rank > coupon.totalQuantity,
        };
      }),
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
    } catch (e) {
      return { success: false, result: 'error', retries: 0, errorMessage: String(e).slice(0, 200) };
    }
  }

  /** 읽고 → 판단하고 → 쓰기. 읽기와 쓰기 사이에 다른 요청이 끼어들면 초과 발급 + lost update */
  private async none(couponId: number, userId: string): Promise<IssueResult> {
    const c = await this.db.coupon.findUniqueOrThrow({ where: { id: couponId } });
    const readIssuedCount = c.issuedCount;
    if (c.issuedCount >= c.totalQuantity) {
      return { success: false, result: 'sold_out', retries: 0, readIssuedCount };
    }
    const row = await this.db.couponIssue.create({ data: { couponId, userId, strategy: 'none' } });
    await this.db.coupon.update({
      where: { id: couponId },
      data: { issuedCount: c.issuedCount + 1 },
    });
    return {
      success: true,
      result: 'issued',
      retries: 0,
      issueRowId: row.id.toString(),
      readIssuedCount,
    };
  }

  /** SELECT ... FOR UPDATE: 행 락을 잡은 트랜잭션만 진행, 나머지는 줄을 서서 대기 */
  private async pessimistic(couponId: number, userId: string): Promise<IssueResult> {
    const t0 = performance.now();
    return this.db.$transaction(
      async (tx) => {
        const t1 = performance.now();
        const rows = await tx.$queryRaw<{ issuedCount: number; totalQuantity: number }[]>`
          SELECT issuedCount, totalQuantity FROM Coupon WHERE id = ${couponId} FOR UPDATE`;
        const t2 = performance.now();
        const waits = { poolWaitMs: round(t1 - t0), lockWaitMs: round(t2 - t1) };
        const c = rows[0];
        if (!c || c.issuedCount >= c.totalQuantity) {
          return { success: false, result: 'sold_out', retries: 0, ...waits } as IssueResult;
        }
        const row = await tx.couponIssue.create({
          data: { couponId, userId, strategy: 'pessimistic' },
        });
        await tx.coupon.update({
          where: { id: couponId },
          data: { issuedCount: { increment: 1 } },
        });
        return {
          success: true,
          result: 'issued',
          retries: 0,
          issueRowId: row.id.toString(),
          ...waits,
        } as IssueResult;
      },
      { maxWait: 60_000, timeout: 60_000 },
    );
  }

  /** version 비교 후 갱신(CAS). 누가 먼저 바꿨으면 0행 갱신 → 다시 읽고 재시도 */
  private async optimistic(couponId: number, userId: string): Promise<IssueResult> {
    for (let retries = 0; retries <= OPTIMISTIC_MAX_RETRIES; retries++) {
      const c = await this.db.coupon.findUniqueOrThrow({ where: { id: couponId } });
      if (c.issuedCount >= c.totalQuantity) return { success: false, result: 'sold_out', retries };
      const { count } = await this.db.coupon.updateMany({
        where: { id: couponId, version: c.version },
        data: { issuedCount: { increment: 1 }, version: { increment: 1 } },
      });
      if (count === 1) {
        const row = await this.db.couponIssue.create({
          data: { couponId, userId, strategy: 'optimistic' },
        });
        return { success: true, result: 'issued', retries, issueRowId: row.id.toString() };
      }
      // 충돌: 짧은 랜덤 백오프 후 재시도 (동시에 재시도해서 또 부딪히는 것 완화)
      await sleep(Math.random() * 5 * (retries + 1));
    }
    return { success: false, result: 'retry_exhausted', retries: OPTIMISTIC_MAX_RETRIES };
  }

  /** 조건부 원자적 UPDATE 한 문장: 판단과 증가를 DB가 한 번에 처리 */
  private async atomic(couponId: number, userId: string): Promise<IssueResult> {
    const affectedRows = await this.db.$executeRaw`
      UPDATE Coupon SET issuedCount = issuedCount + 1
      WHERE id = ${couponId} AND issuedCount < totalQuantity`;
    if (affectedRows !== 1) return { success: false, result: 'sold_out', retries: 0, affectedRows };
    const row = await this.db.couponIssue.create({
      data: { couponId, userId, strategy: 'atomic' },
    });
    return {
      success: true,
      result: 'issued',
      retries: 0,
      affectedRows,
      issueRowId: row.id.toString(),
    };
  }

  private async snapshot(couponId: number, atMs: number): Promise<DbSnapshot | null> {
    const rows = await this.sampler.$queryRaw<
      { issuedCount: number; version: number; issueRows: bigint }[]
    >`SELECT c.issuedCount, c.version,
             (SELECT COUNT(*) FROM CouponIssue i WHERE i.couponId = c.id) AS issueRows
      FROM Coupon c WHERE c.id = ${couponId}`;
    const r = rows[0];
    return r
      ? {
          atMs: round(atMs),
          issuedCount: r.issuedCount,
          version: r.version,
          issueRows: Number(r.issueRows),
        }
      : null;
  }

  /** users명이 동시에 quantity개 쿠폰에 몰리는 상황을 서버 내부에서 재현 */
  async simulate(
    strategy: Strategy,
    users: number,
    quantity: number,
    name = `sim-${strategy}`,
  ): Promise<SimulationResult> {
    const coupon = await this.reset(name, quantity);
    const dbSnapshots: DbSnapshot[] = [{ atMs: 0, issuedCount: 0, version: 0, issueRows: 0 }];
    const t0 = performance.now();
    let running = true;
    // 별도 커넥션으로 DB를 주기적으로 관찰 (이전 샘플이 끝나야 다음 샘플)
    const sampling = (async () => {
      while (running) {
        await sleep(SNAPSHOT_EVERY_MS);
        try {
          const snap = await this.snapshot(coupon.id, performance.now() - t0);
          if (snap) dbSnapshots.push(snap);
        } catch {
          // 관찰 실패는 무시
        }
      }
    })();

    let successSeq = 0;
    const requests: RequestTrace[] = await Promise.all(
      Array.from({ length: users }, async (_, requestId) => {
        const userId = `user-${requestId}`;
        const s = performance.now() - t0;
        const r = await this.issue(strategy, coupon.id, userId);
        const e = performance.now() - t0;
        const issueSeq = r.success ? ++successSeq : undefined;
        return {
          requestId,
          userId,
          startedAtMs: round(s),
          finishedAtMs: round(e),
          durationMs: round(e - s),
          ...r,
          issueSeq,
          oversold: issueSeq !== undefined && issueSeq > quantity,
        };
      }),
    );
    const durationMs = round(performance.now() - t0);
    running = false;
    await sampling;
    const last = await this.snapshot(coupon.id, durationMs);
    if (last) dbSnapshots.push(last);

    const summary = { issued: 0, sold_out: 0, retry_exhausted: 0, error: 0, totalRetries: 0 };
    for (const r of requests) {
      summary[r.result]++;
      summary.totalRetries += r.retries;
    }
    const fin = last ?? { issuedCount: 0, version: 0, issueRows: 0 };
    return {
      strategy,
      couponName: name,
      couponId: coupon.id,
      users,
      quantity,
      durationMs,
      final: {
        issueRows: fin.issueRows,
        issuedCount: fin.issuedCount,
        version: fin.version,
        oversold: Math.max(0, fin.issueRows - quantity),
        counterMismatch: fin.issuedCount !== fin.issueRows,
      },
      summary,
      dbSnapshots,
      requests: requests.sort((a, b) => a.finishedAtMs - b.finishedAtMs),
    };
  }
}
