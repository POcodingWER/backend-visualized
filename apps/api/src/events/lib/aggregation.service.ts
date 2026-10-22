import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { DAY_MS, resolveDayRange, toDailySeries, toDateKey } from './date-range';

@Injectable()
export class AggregationService {
  private readonly log = new Logger(AggregationService.name);
  private running = false;
  private readonly LOCK_KEY_PREFIX = 'cron:aggregation:';
  /** 락 TTL: 5분 cron이므로 4분 (다음 실행 전에 만료). DEL하지 않고 TTL로만 관리. */
  private readonly LOCK_TTL_MS = 4 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * [start, endExclusive) 구간의 Event를 KST 날짜·name 별로 집계해 EventDailyStat에 upsert.
   * createdAt은 UTC로 저장되므로 +9시간 한 뒤 DATE()를 취해 KST 달력 날짜로 묶는다.
   * INSERT ... SELECT ... ON DUPLICATE KEY UPDATE 한 방으로 DB 안에서 처리 (멱등).
   */
  async aggregate(start: Date, endExclusive: Date): Promise<{ rows: number; ms: number }> {
    const t0 = Date.now();
    const affected = await this.prisma.$executeRaw`
      INSERT INTO EventDailyStat (date, name, count, uniqueSessions, updatedAt)
      SELECT DATE(createdAt + INTERVAL 9 HOUR) AS d, name, COUNT(*), COUNT(DISTINCT sessionId), UTC_TIMESTAMP(3)
      FROM Event
      WHERE createdAt >= ${start} AND createdAt < ${endExclusive}
      GROUP BY d, name
      ON DUPLICATE KEY UPDATE count = VALUES(count), uniqueSessions = VALUES(uniqueSessions), updatedAt = UTC_TIMESTAMP(3)`;
    return { rows: affected, ms: Date.now() - t0 };
  }

  async aggregateRange(from?: string, to?: string) {
    const { start, endExclusive, days } = resolveDayRange(from, to, { defaultDays: 2 });
    const result = await this.aggregate(start, endExclusive);
    return { from: days[0], to: days[days.length - 1], ...result };
  }

  /**
   * 5분마다 어제~오늘(KST) 재집계. Redis lock으로 여러 인스턴스 중 한 곳에서만 실행.
   * 5분 타임슬롯별 키 (cron:aggregation:202610220135)로 구분해, 한 슬롯에서 한 인스턴스만 실행.
   * TTL 4분으로 다음 슬롯 전에 만료 (DEL하지 않음 = 끝나도 다른 인스턴스가 같은 슬롯 다시 못 뜸).
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduled() {
    if (this.running) return;
    // 5분 슬롯 키: YYYYMMDDHHMM을 5분 단위로 (예: 13:07 → 13:05, 13:12 → 13:10)
    const now = new Date();
    const minutes = Math.floor(now.getMinutes() / 5) * 5;
    const slotKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(minutes).padStart(2, '0')}`;
    const lockKey = this.LOCK_KEY_PREFIX + slotKey;
    try {
      const acquired = (await this.redis.set(lockKey, '1', 'PX', this.LOCK_TTL_MS, 'NX')) === 'OK';
      if (!acquired) return; // 다른 인스턴스가 이미 이 슬롯 처리 중
      this.running = true;
      const result = await this.aggregateRange();
      this.log.log(`daily aggregate upserted (affected=${result.rows}, ${result.ms}ms)`);
    } catch (error) {
      this.log.error('daily aggregate failed', error as Error);
    } finally {
      this.running = false;
      // DEL 안 함: TTL로 만료 대기 (끝나도 다른 인스턴스가 같은 슬롯 다시 못 뜸)
    }
  }

  async daily(from?: string, to?: string) {
    const { days } = resolveDayRange(from, to);
    const stats = await this.prisma.eventDailyStat.findMany({
      where: { date: { gte: new Date(days[0]!), lt: new Date(Date.parse(days.at(-1)!) + DAY_MS) } },
      orderBy: [{ date: 'asc' }, { name: 'asc' }],
    });
    const rows = stats.map((stat) => ({
      date: toDateKey(stat.date),
      name: stat.name,
      count: stat.count,
      uniqueSessions: stat.uniqueSessions,
    }));
    return { from: days[0], to: days[days.length - 1], rows, ...toDailySeries(days, rows) };
  }
}
