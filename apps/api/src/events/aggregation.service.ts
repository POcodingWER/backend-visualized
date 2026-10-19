import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { DAY_MS, resolveDayRange, startOfUtcDay, toDailySeries, toDateKey } from './date-range';

@Injectable()
export class AggregationService {
  private readonly log = new Logger(AggregationService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * [start, endExclusive) 구간의 Event를 UTC 날짜·name 별로 집계해 EventDailyStat에 upsert.
   * INSERT ... SELECT ... ON DUPLICATE KEY UPDATE 한 방으로 DB 안에서 처리 (멱등).
   */
  async aggregate(start: Date, endExclusive: Date): Promise<{ rows: number; ms: number }> {
    const t0 = Date.now();
    const affected = await this.prisma.$executeRaw`
      INSERT INTO EventDailyStat (date, name, count, uniqueSessions, updatedAt)
      SELECT DATE(createdAt) AS d, name, COUNT(*), COUNT(DISTINCT sessionId), NOW(3)
      FROM Event
      WHERE createdAt >= ${start} AND createdAt < ${endExclusive}
      GROUP BY d, name
      ON DUPLICATE KEY UPDATE count = VALUES(count), uniqueSessions = VALUES(uniqueSessions), updatedAt = NOW(3)`;
    return { rows: affected, ms: Date.now() - t0 };
  }

  async aggregateRange(from?: string, to?: string) {
    const { start, endExclusive, days } = resolveDayRange(from, to, { defaultDays: 2 });
    const result = await this.aggregate(start, endExclusive);
    return { from: days[0], to: days[days.length - 1], ...result };
  }

  /** 5분마다 어제~오늘(UTC) 재집계 */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduled() {
    if (this.running) return;
    this.running = true;
    try {
      const today = startOfUtcDay(new Date());
      const result = await this.aggregate(
        new Date(today.getTime() - DAY_MS),
        new Date(today.getTime() + DAY_MS),
      );
      this.log.log(`daily aggregate upserted (affected=${result.rows}, ${result.ms}ms)`);
    } catch (error) {
      this.log.error('daily aggregate failed', error as Error);
    } finally {
      this.running = false;
    }
  }

  async daily(from?: string, to?: string) {
    const { start, endExclusive, days } = resolveDayRange(from, to);
    const stats = await this.prisma.eventDailyStat.findMany({
      where: { date: { gte: start, lt: endExclusive } },
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
