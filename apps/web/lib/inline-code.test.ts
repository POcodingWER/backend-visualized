import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidElement } from 'react';
import { withCode } from './inline-code';
import { REASONS, RETRO, TROUBLES } from '../app/deploy/content';
import { DEPLOY_STEPS } from '../app/deploy/steps';

test('백틱이 없으면 문자열 그대로, 있으면 홀수 조각이 <code>', () => {
  assert.equal(withCode('그냥 글'), '그냥 글');
  const parts = withCode('a `b` c') as unknown[];
  assert.equal(parts.length, 3);
  assert.ok(isValidElement(parts[1]) && parts[1].type === 'code');
});

test('배포 페이지 글의 백틱은 모두 짝이 맞다', () => {
  const texts = [
    ...DEPLOY_STEPS.flatMap((step) => [step.title, step.plain, step.result ?? '']),
    ...REASONS.flatMap((reason) => [reason.question, reason.answer, reason.cost ?? '']),
    ...TROUBLES.flatMap((trouble) => Object.values(trouble).flat()),
    ...RETRO.hard,
    ...RETRO.learned,
    ...RETRO.next,
  ];
  for (const text of texts) {
    assert.equal(text.split('`').length % 2, 1, `백틱 짝이 안 맞음: ${text}`);
  }
});
