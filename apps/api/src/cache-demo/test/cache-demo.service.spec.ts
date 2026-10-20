/** 실제 Redis + MySQL로 6장 핵심 검증: 만료 순간 동시 요청 300개 → Redis 잠금이면 DB 읽기 1번. 없으면 skip (CI는 실패) */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CacheDemoService } from '../cache-demo.service';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env 없음 → skip
  }
}

describe('menu cache stampede (Redis + MySQL)', () => {
  const prisma = new PrismaService();
  // 앱과 같은 연결 설정 (REDIS_URL, 없으면 로컬 bv-redis 6380)
  const redis = new RedisService();
  const menu = new CacheDemoService(prisma, redis);
  menu.boardName = `test-board-${process.pid}`;
  let up = false;

  before(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.connect();
      up = true;
    } catch (error) {
      if (process.env.REQUIRE_DATABASE === 'true') throw error;
    }
  });
  after(async () => {
    if (up) {
      await redis.del(menu.cacheKey, menu.lockKey);
      await prisma.menuBoard.deleteMany({ where: { name: menu.boardName } });
    }
    redis.disconnect();
    await prisma.$disconnect();
  });

  test('first visitors on an empty DB: concurrent reads create the board row once, no error', async (testContext) => {
    if (!up) return testContext.skip('DB or Redis unavailable');
    const result = await menu.welcomeVisitors(200);
    assert.equal(result.direct.dbReads, 200);
    assert.equal(await prisma.menuBoard.count({ where: { name: menu.boardName } }), 1);
  });

  test('redis lock: 1 DB read; single-flight: 1 per server; none: 1 per visitor', async (testContext) => {
    if (!up) return testContext.skip('DB or Redis unavailable');
    await menu.readDirect(); // 원본 메뉴(MenuBoard) 행 만들기
    const locked = await menu.stampede('redis-lock', 300, 3);
    assert.equal(locked.dbReads, 1);
    assert.equal(locked.commands['SET EX'], 1);
    const perServer = await menu.stampede('single-flight', 300, 3);
    assert.equal(perServer.dbReads, 3);
    const none = await menu.stampede('none', 300, 3);
    assert.equal(none.dbReads, 300);
  });

  test('first edit on a fresh board (version 1, like the page right after an empty DB) works', async (testContext) => {
    if (!up) return testContext.skip('DB or Redis unavailable');
    const fresh = new CacheDemoService(prisma, redis);
    fresh.boardName = `test-first-edit-${process.pid}`;
    try {
      const [direct, cached] = await Promise.all([fresh.readDirect(), fresh.readThroughCache()]);
      assert.equal(direct.board.version, 1);
      assert.equal(cached.board.version, 1);
      const edited = await fresh.edit(false);
      assert.equal(edited.board.version, 2);
      assert.equal((await fresh.readDirect()).board.version, 2);
      assert.equal((await fresh.readThroughCache()).board.version, 1); // 메뉴판은 TTL까지 옛 메뉴
      await fresh.edit(true);
      assert.equal((await fresh.readThroughCache()).board.version, 3); // 지우면 바로 새 메뉴
    } finally {
      await redis.del(fresh.cacheKey, fresh.lockKey);
      await prisma.menuBoard.deleteMany({ where: { name: fresh.boardName } });
    }
  });

  test('edit without DEL serves stale until TTL; with DEL serves new at once', async (testContext) => {
    if (!up) return testContext.skip('DB or Redis unavailable');
    const before = await menu.readThroughCache();
    const edited = await menu.edit(false);
    const stale = await menu.readThroughCache();
    assert.equal(stale.source, 'cache');
    assert.equal(stale.board.version, before.board.version);
    await menu.edit(true);
    const fresh = await menu.readThroughCache();
    assert.equal(fresh.source, 'db');
    assert.equal(fresh.board.version, edited.board.version + 1);
  });
});
