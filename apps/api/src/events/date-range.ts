import { BadRequestException } from '@nestjs/common';

export const DAY_MS = 86_400_000;

export function parseDate(rawValue: string | undefined, field: string): Date | undefined {
  if (!rawValue) return undefined;
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`invalid ${field}`);
  return date;
}

/** UTC 자정으로 내림 */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * from~to(포함) 날짜 범위를 [start, endExclusive) UTC 자정 경계로 정규화.
 * 기본값: to=오늘, from=to-(defaultDays-1). 최대 maxDays일.
 */
export function resolveDayRange(
  fromStr: string | undefined,
  toStr: string | undefined,
  { defaultDays = 7, maxDays = 366, now = new Date() } = {},
): { start: Date; endExclusive: Date; days: string[] } {
  const to = startOfUtcDay(parseDate(toStr, 'to') ?? now);
  const from = startOfUtcDay(
    parseDate(fromStr, 'from') ?? new Date(to.getTime() - (defaultDays - 1) * DAY_MS),
  );
  if (from > to) throw new BadRequestException('from must be <= to');
  const dayCount = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (dayCount > maxDays) throw new BadRequestException(`range too large (max ${maxDays} days)`);
  const days = Array.from({ length: dayCount }, (_, i) =>
    toDateKey(new Date(from.getTime() + i * DAY_MS)),
  );
  return { start: from, endExclusive: new Date(to.getTime() + DAY_MS), days };
}

export interface DailyRow {
  date: string;
  name: string;
  count: number;
  uniqueSessions: number;
}

/** 집계 행을 날짜별 시리즈로 변환 (빈 날짜는 0으로 채움) */
export function toDailySeries(days: string[], rows: DailyRow[]) {
  const names = [...new Set(rows.map((row) => row.name))].sort();
  const series = days.map((date) => {
    const point: { date: string; total: number; byName: Record<string, number> } = {
      date,
      total: 0,
      byName: Object.fromEntries(names.map((name) => [name, 0])),
    };
    return point;
  });
  const seriesByDate = new Map(series.map((point) => [point.date, point]));
  for (const row of rows) {
    const point = seriesByDate.get(row.date);
    if (!point) continue;
    point.byName[row.name] = row.count;
    point.total += row.count;
  }
  return { names, series };
}
