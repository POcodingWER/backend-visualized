import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roundToTenth, sleep, startStopwatch } from '../time';

test('roundToTenth keeps one decimal', () => {
  assert.equal(roundToTenth(12.345), 12.3);
  assert.equal(roundToTenth(0.06), 0.1);
});

test('startStopwatch counts up from 0', async () => {
  const elapsed = startStopwatch();
  const first = elapsed();
  await sleep(15);
  const second = elapsed();
  assert.ok(first >= 0 && first < 5);
  assert.ok(second >= 10, `expected >= 10ms, got ${second}`);
});
