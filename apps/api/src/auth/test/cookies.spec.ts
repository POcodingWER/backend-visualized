import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCookie } from '../lib/cookies';

test('readCookie: picks the named cookie and decodes it', () => {
  assert.equal(readCookie('a=1; bv_refresh_token=abc%2Bdef; b=2', 'bv_refresh_token'), 'abc+def');
  assert.equal(readCookie(undefined, 'bv_refresh_token'), undefined);
});

test('readCookie: keeps "=" inside the value and ignores similar names', () => {
  assert.equal(
    readCookie('bv_refresh_token_old=x; bv_refresh_token=a=b', 'bv_refresh_token'),
    'a=b',
  );
});
