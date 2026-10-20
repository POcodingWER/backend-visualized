import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seconds } from './format';

test('seconds: 화면용 시간은 초 단위, 소수 둘째 자리', () => {
  assert.equal(seconds(143), '0.14초');
  assert.equal(seconds(18_700), '18.70초');
  assert.equal(seconds(4), '0.01초 미만');
});
