import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REASONS } from './content';
import { DEPLOY_STEPS } from './steps';

// 단계의 "왜 이렇게? →" 칩이 없는 카드를 가리키지 않는지, 카드마다 돌아갈 단계가 하나인지
test('단계의 reasons는 모두 REASONS에 있고, 카드마다 단계는 하나', () => {
  const ids = REASONS.map((reason) => reason.id);
  assert.equal(new Set(ids).size, ids.length, 'REASONS id 중복');
  const linked = DEPLOY_STEPS.flatMap((step) => step.reasons ?? []);
  for (const id of linked) assert.ok(ids.includes(id), `없는 이유 카드: ${id}`);
  assert.equal(new Set(linked).size, linked.length, '한 카드에 단계가 여러 개');
  // 한 단계에 카드가 둘 이상이면 칩 이름(label)이 있어야 "왜 GHCR? →"처럼 구분된다
  for (const step of DEPLOY_STEPS.filter((item) => (item.reasons?.length ?? 0) > 1)) {
    for (const id of step.reasons!) {
      assert.ok(REASONS.find((reason) => reason.id === id)?.label, `${id} 카드에 label 없음`);
    }
  }
});

test('HTTPS 단계에서 sslip.io · Caddy 카드로 바로 간다', () => {
  const step = DEPLOY_STEPS.find((item) => item.title.includes('Caddy'));
  assert.deepEqual(step?.reasons, ['sslip', 'caddy']);
  const caddy = REASONS.find((reason) => reason.id === 'caddy');
  assert.ok(caddy?.compare?.length, 'Caddy 카드에 비교가 없음');
});
