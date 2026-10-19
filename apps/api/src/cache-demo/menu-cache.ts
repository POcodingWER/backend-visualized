import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { createSingleFlight } from './single-flight';

/** 캐시 유효 시간 (Redis SET ... EX) */
export const CACHE_TTL_SECONDS = 5;
/** 캐시를 다시 채우는 한 명만 잡는 잠금. 그 사람이 죽어도 2초 뒤 저절로 풀린다 (SET ... NX PX) */
export const LOCK_TTL_MS = 2_000;
const LOCK_WAIT_POLL_MS = 20;
const LOCK_WAIT_LIMIT_MS = 1_000;

export const STAMPEDE_PROTECTIONS = ['none', 'single-flight', 'redis-lock'] as const;
export type StampedeProtection = (typeof STAMPEDE_PROTECTIONS)[number];

const MENUS = ['김치찌개', '된장찌개', '제육볶음', '순두부찌개', '비빔밥', '칼국수'];
const menuText = (version: number) =>
  `오늘의 메뉴: ${MENUS[(version - 1) % MENUS.length]} (${version}번째 판)`;

/** 잠금 주인만 지운다: 내 토큰일 때만 DEL (잠금이 만료돼 남이 새로 잡은 걸 지우지 않도록) */
const RELEASE_LOCK_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

export interface MenuBoardView {
  content: string;
  version: number;
}

/** 화면에 그릴 이동 한 칸: 누가 누구에게 무엇을 보냈나 */
export interface Hop {
  from: 'api' | 'redis' | 'db';
  to: 'api' | 'redis' | 'db';
  label: string;
}

export type RedisCommandName = 'GET' | 'SET EX' | 'SET NX' | 'DEL';

export interface CacheStats {
  dbReads: number;
  commands: Record<RedisCommandName, number>;
}

export type VisitorPath = 'cache' | 'db' | 'waited' | 'db-fallback';

export interface VisitorTrace {
  instance: number;
  startedAtMs: number;
  finishedAtMs: number;
  /** cache: 캐시에서 바로 / db: 내가 DB를 읽음 / waited: 다른 사람이 채운 걸 기다려 받음 / db-fallback: 기다리다 포기하고 DB */
  path: VisitorPath;
}

export const emptyStats = (): CacheStats => ({
  dbReads: 0,
  commands: { GET: 0, 'SET EX': 0, 'SET NX': 0, DEL: 0 },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MenuCache {
  readonly cacheKey: string;
  readonly lockKey: string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    readonly boardName = 'board',
  ) {
    // 다른 앱의 키와 섞이지 않게 bv: 접두사
    this.cacheKey = `bv:menu:${boardName}`;
    this.lockKey = `bv:menu:${boardName}:lock`;
  }

  async readFromDb(stats: CacheStats): Promise<MenuBoardView> {
    stats.dbReads++;
    // findUnique는 Prisma가 같은 틱의 호출을 한 쿼리로 묶어 버려서(배칭) "DB 읽기 1000번"이 1번이 된다 → findFirst로 진짜 1번씩
    const board =
      (await this.prisma.menuBoard.findFirst({ where: { name: this.boardName } })) ??
      (await this.prisma.menuBoard.upsert({
        where: { name: this.boardName },
        create: { name: this.boardName, content: menuText(1), version: 1 },
        update: {},
      }));
    return { content: board.content, version: board.version };
  }

  /** DB를 읽어 캐시에 5초짜리로 넣는다 */
  private async loadAndFill(stats: CacheStats): Promise<MenuBoardView> {
    const board = await this.readFromDb(stats);
    stats.commands['SET EX']++;
    await this.redis.set(this.cacheKey, JSON.stringify(board), 'EX', CACHE_TTL_SECONDS);
    return board;
  }

  private async getCached(stats: CacheStats): Promise<MenuBoardView | null> {
    stats.commands.GET++;
    const cached = await this.redis.get(this.cacheKey);
    return cached ? (JSON.parse(cached) as MenuBoardView) : null;
  }

  /** 왼쪽: 매번 DB */
  async readDirect() {
    const board = await this.readFromDb(emptyStats());
    const hops: Hop[] = [
      { from: 'api', to: 'db', label: 'SELECT' },
      { from: 'db', to: 'api', label: '행' },
    ];
    return { board, source: 'db' as const, hops, ttlLeftMs: null };
  }

  /** 오른쪽: cache-aside. GET → 없으면 DB → SET EX 5 */
  async readThroughCache() {
    const stats = emptyStats();
    const cached = await this.getCached(stats);
    const hops: Hop[] = [{ from: 'api', to: 'redis', label: 'GET' }];
    if (cached) {
      hops.push({ from: 'redis', to: 'api', label: 'hit' });
      return { board: cached, source: 'cache' as const, hops, ttlLeftMs: await this.ttlLeftMs() };
    }
    const board = await this.loadAndFill(stats);
    hops.push(
      { from: 'redis', to: 'api', label: 'miss' },
      { from: 'api', to: 'db', label: 'SELECT' },
      { from: 'db', to: 'api', label: '행' },
      { from: 'api', to: 'redis', label: `SET EX ${CACHE_TTL_SECONDS}` },
    );
    return { board, source: 'db' as const, hops, ttlLeftMs: CACHE_TTL_SECONDS * 1000 };
  }

  private async ttlLeftMs(): Promise<number | null> {
    const ttl = await this.redis.pttl(this.cacheKey);
    return ttl >= 0 ? ttl : null;
  }

  /** 내용 수정. invalidate면 캐시 키를 지워(DEL) 다음 읽기가 새 내용을 가져가게 한다 */
  async edit(invalidate: boolean) {
    const current = await this.readFromDb(emptyStats());
    const version = current.version + 1;
    await this.prisma.menuBoard.update({
      where: { name: this.boardName },
      data: { content: menuText(version), version },
    });
    const hops: Hop[] = [{ from: 'api', to: 'db', label: 'UPDATE' }];
    if (invalidate) {
      await this.redis.del(this.cacheKey);
      hops.push({ from: 'api', to: 'redis', label: 'DEL' });
    }
    return { board: { content: menuText(version), version }, hops };
  }

  /** Redis 잠금: 캐시가 비었을 때 SET NX로 잠금을 잡은 한 명만 DB를 읽고, 나머지는 잠깐 기다렸다 캐시에서 받는다 */
  private async readWithRedisLock(stats: CacheStats): Promise<VisitorPath> {
    if (await this.getCached(stats)) return 'cache';
    const token = randomUUID();
    stats.commands['SET NX']++;
    const acquired = await this.redis.set(this.lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
    if (acquired === 'OK') {
      try {
        await this.loadAndFill(stats);
      } finally {
        stats.commands.DEL++;
        await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, this.lockKey, token);
      }
      return 'db';
    }
    const giveUpAt = performance.now() + LOCK_WAIT_LIMIT_MS;
    while (performance.now() < giveUpAt) {
      await sleep(LOCK_WAIT_POLL_MS);
      if (await this.getCached(stats)) return 'waited';
    }
    await this.readFromDb(stats); // 잠금 주인이 너무 늦으면 DB에서 직접 (캐시는 안 채움)
    return 'db-fallback';
  }

  /**
   * 캐시가 막 만료된 순간 손님이 한꺼번에 몰리는 상황(cache stampede)을 실제 Redis·MySQL로 재현.
   * 서버 instances대를 한 프로세스 안에서 흉내 낸다: single-flight는 서버(인스턴스)마다 따로라 대수만큼 DB를 읽는다.
   */
  async stampede(protection: StampedeProtection, visitors: number, instances: number) {
    await this.redis.del(this.cacheKey, this.lockKey); // 만료된 순간
    const stats = emptyStats();
    const startedAt = performance.now();
    const clock = () => Math.round((performance.now() - startedAt) * 10) / 10;

    const leaderFlags = Array.from({ length: instances }, () => ({ startedNow: false }));
    const flights = leaderFlags.map((flag) =>
      createSingleFlight(() => {
        flag.startedNow = true;
        return this.loadAndFill(stats);
      }),
    );

    const visit = async (instance: number): Promise<VisitorPath> => {
      if (protection === 'redis-lock') return this.readWithRedisLock(stats);
      if (await this.getCached(stats)) return 'cache';
      if (protection === 'none') {
        await this.loadAndFill(stats);
        return 'db';
      }
      const flag = leaderFlags[instance]!;
      flag.startedNow = false;
      const shared = flights[instance]!(); // 이미 진행 중이면 그 Promise를 같이 기다린다
      const isLeader = flag.startedNow;
      await shared;
      return isLeader ? 'db' : 'waited';
    };

    const traces = await Promise.all(
      Array.from({ length: visitors }, async (_, index): Promise<VisitorTrace> => {
        const instance = index % instances;
        const startedAtMs = clock();
        const path = await visit(instance);
        return { instance, startedAtMs, finishedAtMs: clock(), path };
      }),
    );
    return { protection, visitors, instances, durationMs: clock(), ...stats, traces };
  }

  /** 큰 버튼: 손님 visitors명이 매번 DB로 vs 캐시로 (캐시는 첫 손님 한 명이 채운 뒤) */
  async welcomeVisitors(visitors: number) {
    const measure = async (read: (stats: CacheStats) => Promise<unknown>) => {
      const stats = emptyStats();
      const startedAt = performance.now();
      await Promise.all(Array.from({ length: visitors }, () => read(stats)));
      return { visitors, dbReads: stats.dbReads, ms: Math.round(performance.now() - startedAt) };
    };
    const direct = await measure((stats) => this.readFromDb(stats));
    const warmUp = emptyStats();
    if (!(await this.getCached(warmUp))) await this.loadAndFill(warmUp);
    const cached = await measure(async (stats) => {
      if (!(await this.getCached(stats))) await this.loadAndFill(stats);
    });
    return { direct, cached: { ...cached, dbReads: cached.dbReads + warmUp.dbReads } };
  }
}
