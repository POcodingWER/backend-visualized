import { BadRequestException } from '@nestjs/common';

export const DAY_MS = 86_400_000;

export function parseDate(rawValue: string | undefined, field: string): Date | undefined {
  if (!rawValue) return undefined;
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`invalid ${field}`);
  return date;
}

// ponytail: 한국 서비스라 날짜 경계를 KST(UTC+9, 서머타임 없음) 고정. 다른 시간대가 필요해지면 오프셋을 설정값으로.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 순간(UTC) → 그 순간의 KST 달력 날짜 'YYYY-MM-DD' */
export function toKstDateKey(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD'(KST 날짜) → 그 날 KST 자정의 순간 */
function kstMidnight(dateKey: string): Date {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - KST_OFFSET_MS);
}

/** DATE 컬럼(Prisma는 UTC 자정 Date로 다룸) ↔ 'YYYY-MM-DD' */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD'만 오면 그대로 KST 날짜로, 시각까지 오면 그 순간의 KST 날짜로 */
function toKstDayKey(rawValue: string | undefined, field: string, fallback: Date): string {
  if (rawValue && /^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    parseDate(rawValue, field);
    return rawValue;
  }
  return toKstDateKey(parseDate(rawValue, field) ?? fallback);
}

/**
 * from~to(포함) KST 날짜 범위.
 * days: KST 날짜 목록, start/endExclusive: 그 범위의 KST 자정 경계(Event.createdAt 비교용 순간).
 * 기본값: to=오늘(KST), from=to-(defaultDays-1). 최대 maxDays일.
 */
export function resolveDayRange(
  fromStr: string | undefined,
  toStr: string | undefined,
  { defaultDays = 7, maxDays = 366, now = new Date() } = {},
): { start: Date; endExclusive: Date; days: string[] } {
  const toKey = toKstDayKey(toStr, 'to', now);
  const fromKey = toKstDayKey(
    fromStr,
    'from',
    new Date(kstMidnight(toKey).getTime() - (defaultDays - 1) * DAY_MS),
  );
  const firstDay = Date.parse(fromKey);
  const lastDay = Date.parse(toKey);
  if (firstDay > lastDay) throw new BadRequestException('from must be <= to');
  const dayCount = Math.round((lastDay - firstDay) / DAY_MS) + 1;
  if (dayCount > maxDays) throw new BadRequestException(`range too large (max ${maxDays} days)`);
  const days = Array.from({ length: dayCount }, (_, i) =>
    toDateKey(new Date(firstDay + i * DAY_MS)),
  );
  return {
    start: kstMidnight(fromKey),
    endExclusive: new Date(kstMidnight(toKey).getTime() + DAY_MS),
    days,
  };
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
