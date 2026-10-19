import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminApiKeyGuard, isSameSecret } from './admin-api-key.guard';

const contextWithHeaders = (headers: Record<string, string>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

const guardWith = (adminApiKey: string | null, isProduction: boolean) => {
  const guard = new AdminApiKeyGuard();
  guard.environment = { adminApiKey, isProduction };
  return guard;
};

test('admin guard: key configured → only the exact header value passes', () => {
  const guard = guardWith('a-long-admin-api-key-for-tests', true);
  assert.equal(
    guard.canActivate(contextWithHeaders({ 'x-admin-api-key': 'a-long-admin-api-key-for-tests' })),
    true,
  );
  assert.throws(
    () => guard.canActivate(contextWithHeaders({ 'x-admin-api-key': 'wrong' })),
    UnauthorizedException,
  );
  assert.throws(() => guard.canActivate(contextWithHeaders({})), UnauthorizedException);
});

test('admin guard: no key → open in development, disabled in production', () => {
  assert.equal(guardWith(null, false).canActivate(contextWithHeaders({})), true);
  assert.throws(
    () => guardWith(null, true).canActivate(contextWithHeaders({})),
    ForbiddenException,
  );
});

test('isSameSecret compares values of different lengths safely', () => {
  assert.equal(isSameSecret('abc', 'abc'), true);
  assert.equal(isSameSecret('abc', 'abcd'), false);
});
