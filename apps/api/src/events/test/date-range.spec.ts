import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDayRange, toDailySeries, toKstDateKey } from '../lib/date-range';

test('resolveDayRange: inclusive KST days, KST midnight bounds', () => {
  const range = resolveDayRange('2026-10-01', '2026-10-03');
  assert.deepEqual(range.days, ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(range.start.toISOString(), '2026-09-30T15:00:00.000Z');
  assert.equal(range.endExclusive.toISOString(), '2026-10-03T15:00:00.000Z');
});

test('KST day boundary: 2026-10-19T23:30Z is already 2026-10-20 in Seoul', () => {
  assert.equal(toKstDateKey(new Date('2026-10-19T23:30:00Z')), '2026-10-20');
  assert.equal(toKstDateKey(new Date('2026-10-19T14:59:59Z')), '2026-10-19');
  const today = resolveDayRange(undefined, undefined, {
    defaultDays: 2,
    now: new Date('2026-10-19T23:06:00Z'), // 10-20 08:06 KST
  });
  assert.deepEqual(today.days, ['2026-10-19', '2026-10-20']);
  assert.equal(today.endExclusive.toISOString(), '2026-10-20T15:00:00.000Z');
});

test('resolveDayRange: defaults to last N days', () => {
  const range = resolveDayRange(undefined, undefined, {
    defaultDays: 7,
    now: new Date('2026-10-19T05:00:00Z'),
  });
  assert.equal(range.days.length, 7);
  assert.equal(range.days[0], '2026-10-13');
  assert.equal(range.days[6], '2026-10-19');
});

test('resolveDayRange: rejects bad input', () => {
  assert.throws(() => resolveDayRange('2026-10-05', '2026-10-01'));
  assert.throws(() => resolveDayRange('garbage', undefined));
  assert.throws(() => resolveDayRange('2020-01-01', '2026-01-01'));
});

test('toDailySeries: fills missing days with zero and sums totals', () => {
  const { names, series } = toDailySeries(
    ['2026-10-01', '2026-10-02'],
    [
      { date: '2026-10-01', name: 'page_view', count: 3, uniqueSessions: 2 },
      { date: '2026-10-01', name: 'button_click', count: 5, uniqueSessions: 1 },
    ],
  );
  assert.deepEqual(names, ['button_click', 'page_view']);
  assert.deepEqual(series[0], {
    date: '2026-10-01',
    total: 8,
    byName: { button_click: 5, page_view: 3 },
  });
  assert.deepEqual(series[1], {
    date: '2026-10-02',
    total: 0,
    byName: { button_click: 0, page_view: 0 },
  });
});
