import { BadRequestException } from '@nestjs/common';

export const DAY_MS = 86_400_000;

export function parseDate(v: string | undefined, field: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`invalid ${field}`);
  return d;
}

/** UTC 자정으로 내림 */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  const n = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (n > maxDays) throw new BadRequestException(`range too large (max ${maxDays} days)`);
  const days = Array.from({ length: n }, (_, i) =>
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
  const names = [...new Set(rows.map((r) => r.name))].sort();
  const series = days.map((date) => {
    const point: { date: string; total: number; byName: Record<string, number> } = {
      date,
      total: 0,
      byName: Object.fromEntries(names.map((n) => [n, 0])),
    };
    return point;
  });
  const idx = new Map(series.map((p) => [p.date, p]));
  for (const r of rows) {
    const p = idx.get(r.date);
    if (!p) continue;
    p.byName[r.name] = r.count;
    p.total += r.count;
  }
  return { names, series };
}
