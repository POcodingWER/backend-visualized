/** 4장 설명 문장의 숫자가 실제 시뮬레이션(points.service.ts: 시작 5,000P, 200건 중 4번째마다 사용, 100P씩)과 맞는지 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { PointSimulationResult } from './api';
import { explainLostUpdate } from './lost-update';

const recorded = JSON.parse(
  readFileSync(new URL('../../public/data/ledger-recorded-run.json', import.meta.url), 'utf8'),
) as { results: PointSimulationResult[] };
const byMode = (mode: string) => recorded.results.find((result) => result.mode === mode)!;

test('should-be balance is 5,000 + 150 × 100 − 50 × 100 = 15,000P', () => {
  const explained = explainLostUpdate(byMode('overwrite'));
  assert.equal(explained.opening, 5_000);
  assert.equal(explained.earnCount, 150);
  assert.equal(explained.spendCount, 50);
  assert.equal(explained.pointsEach, 100);
  assert.equal(explained.shouldBe, 15_000);
  assert.equal(explained.shouldBe, byMode('overwrite').expectedBalance);
});

test('overwrite: everyone read the same 5,000P and the last writer decided the balance', () => {
  const explained = explainLostUpdate(byMode('overwrite'));
  assert.equal(explained.readOpening, 200);
  assert.equal(explained.endedAt, 4_900);
  assert.equal(explained.lastWriter?.balanceWritten, explained.endedAt);
  assert.equal(explained.lost, 10_100);
});

test('ledger: nothing lost', () => {
  const explained = explainLostUpdate(byMode('ledger'));
  assert.equal(explained.endedAt, 15_000);
  assert.equal(explained.lost, 0);
});
