import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MenuRead } from './api';
import { emptySide, nextSide, versionLabel, watchWhileMounted } from './menu-watch';

const read = (version: number, ttlLeftMs: number | null = null): MenuRead => ({
  board: { content: `메뉴 (${version}번째 판)`, version },
  source: 'cache',
  hops: [],
  ttlLeftMs,
});

test('effect re-attached (StrictMode / Fast Refresh): watching is not left stopped', () => {
  const stopFlag = { current: false };
  const cleanup = watchWhileMounted(stopFlag);
  cleanup();
  assert.equal(stopFlag.current, true);
  watchWhileMounted(stopFlag);
  assert.equal(stopFlag.current, false);
});

test('first edit (1번째 → 2번째 판): cached side says when it refreshes, not an error', () => {
  const side = { ...emptySide, read: read(1, 3_100) };
  assert.deepEqual(versionLabel(side, 2), {
    text: '1번째 (옛 메뉴 · 3.1초 뒤 새로 확인)',
    isStale: true,
  });
  assert.deepEqual(versionLabel(side, null), { text: '1번째', isStale: false });
});

test('fresh time is the first poll that sees the edited version, and stays', () => {
  let side = nextSide(emptySide, read(1), 2, 500);
  assert.equal(side.freshAfterMs, null);
  side = nextSide(side, read(2), 2, 3_200);
  side = nextSide(side, read(2), 2, 3_700);
  assert.equal(side.freshAfterMs, 3_200);
  assert.equal(versionLabel(side, 2).isStale, false);
});
