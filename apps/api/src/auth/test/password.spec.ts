import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../lib/password';

test('hashPassword: salted (same password → different hash) and verifiable', async () => {
  const first = await hashPassword('demo1234');
  const second = await hashPassword('demo1234');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('demo1234', first), true);
  assert.equal(await verifyPassword('wrong', first), false);
});

test('verifyPassword: a malformed stored hash is rejected, not thrown', async () => {
  assert.equal(await verifyPassword('demo1234', 'not-a-hash'), false);
  assert.equal(await verifyPassword('demo1234', 'abcd:00'), false);
});
