import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDayRange, toDailySeries } from './date-range';

test('resolveDayRange: inclusive days, UTC midnight bounds', () => {
  const r = resolveDayRange('2026-10-01T15:00:00Z', '2026-10-03');
  assert.deepEqual(r.days, ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(r.start.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(r.endExclusive.toISOString(), '2026-10-04T00:00:00.000Z');
});

test('resolveDayRange: defaults to last N days', () => {
  const r = resolveDayRange(undefined, undefined, {
    defaultDays: 7,
    now: new Date('2026-10-19T05:00:00Z'),
  });
  assert.equal(r.days.length, 7);
  assert.equal(r.days[0], '2026-10-13');
  assert.equal(r.days[6], '2026-10-19');
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
