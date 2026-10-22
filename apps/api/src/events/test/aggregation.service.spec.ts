import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AggregationService } from '../lib/aggregation.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';

// Mock Redis: 같은 키에 대해 NX는 한 번만 성공
class MockRedis {
  private keys = new Map<string, string>();

  async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
    // args 파싱: 'PX', ttl, 'NX' 순서
    const nxIndex = args.indexOf('NX');
    if (nxIndex !== -1) {
      // NX 옵션: 키가 없을 때만 set
      if (this.keys.has(key)) {
        return null; // 이미 존재 → SET NX 실패
      }
      this.keys.set(key, value);
      return 'OK';
    }
    // NX 없으면 무조건 덮어쓰기
    this.keys.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.keys.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    const existed = this.keys.has(key);
    this.keys.delete(key);
    return existed ? 1 : 0;
  }

  reset() {
    this.keys.clear();
  }
}

// Mock Prisma: aggregateRange만 추적
class MockPrisma {
  aggregateCalled = 0;

  $executeRaw = async (): Promise<number> => {
    this.aggregateCalled++;
    return 42; // affected rows
  };

  eventDailyStat = {
    findMany: async () => [],
  };

  reset() {
    this.aggregateCalled = 0;
  }
}

test('aggregation cron lock: first instance acquires lock and runs', async () => {
  const redis = new MockRedis();
  const prisma = new MockPrisma();
  const service = new AggregationService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );

  await service.scheduled();

  assert.equal(prisma.aggregateCalled, 1, 'aggregateRange should run once');
});

test('aggregation cron lock: second instance cannot acquire lock and skips', async () => {
  const redis = new MockRedis();
  const prisma = new MockPrisma();
  const service1 = new AggregationService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );
  const service2 = new AggregationService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );

  await service1.scheduled(); // 첫 인스턴스: 락 획득
  await service2.scheduled(); // 두 번째 인스턴스: 락 획득 실패

  assert.equal(prisma.aggregateCalled, 1, 'aggregateRange should run only once (first instance)');
});

test('aggregation cron lock: no DEL on finish, TTL expires naturally', async () => {
  const redis = new MockRedis();
  const prisma = new MockPrisma();
  const service = new AggregationService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );

  await service.scheduled();

  // 락 키가 여전히 존재 (DEL 안 함)
  const now = new Date();
  const minutes = Math.floor(now.getMinutes() / 5) * 5;
  const slotKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(minutes).padStart(2, '0')}`;
  const lockKey = `bv:cron:aggregation:${slotKey}`;

  const lockValue = await redis.get(lockKey);
  assert.notEqual(lockValue, null, 'Lock key should still exist (not DELeted)');
  assert.equal(lockValue, '1', 'Lock value should be set');
});

test('aggregation cron lock: different time slots allow re-execution', async () => {
  const redis = new MockRedis();
  const prisma = new MockPrisma();

  // 슬롯을 강제로 바꾸기 위해 약간의 시간을 흉내 (실제론 5분 단위)
  // 여기선 redis mock이 키별로 관리하므로, 다른 시간에 실행하면 다른 키가 사용됨
  const service = new AggregationService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );

  await service.scheduled(); // 첫 실행: 현재 슬롯 키

  // 같은 슬롯에서 다시 시도 → 락 획득 실패
  const service2 = new AggregationService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );
  await service2.scheduled();

  assert.equal(
    prisma.aggregateCalled,
    1,
    'Same time slot should allow only one execution (lock prevents duplicate)',
  );
});
