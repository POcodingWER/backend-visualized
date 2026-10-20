import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnvironmentError, loadEnvironment, parseTrustProxy } from '../environment';

const productionBase = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://app:password@db.example.com:3306/backend_visualized',
  WEB_ORIGIN: 'https://backend-visualized.vercel.app',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  REDIS_URL: 'redis://redis:6379/0',
};

const problemsOf = (env: NodeJS.ProcessEnv): string[] => {
  try {
    loadEnvironment(env);
    return [];
  } catch (error) {
    assert.ok(error instanceof EnvironmentError);
    return error.problems;
  }
};

test('development: works with no env at all and uses local defaults', () => {
  const environment = loadEnvironment({});
  assert.equal(environment.isProduction, false);
  assert.deepEqual(environment.webOrigins, ['http://localhost:3000']);
  assert.deepEqual(environment.refreshCookie, {
    sameSite: 'lax',
    secure: false,
    partitioned: false,
  });
  assert.equal(environment.authDemoEndpointsEnabled, true);
  assert.equal(environment.trustProxy, false);
});

test('production: a complete config passes with cross-site cookie defaults', () => {
  const environment = loadEnvironment(productionBase);
  assert.deepEqual(environment.refreshCookie, {
    sameSite: 'none',
    secure: true,
    partitioned: true,
  });
  assert.equal(environment.authDemoEndpointsEnabled, false);
  assert.equal(environment.adminApiKey, null);
});

test('production: missing DATABASE_URL, REDIS_URL, WEB_ORIGIN and JWT secret are all reported together', () => {
  const problems = problemsOf({ NODE_ENV: 'production' });
  assert.equal(problems.length, 4);
  assert.ok(problems.some((problem) => problem.includes('REDIS_URL')));
  assert.ok(problems.some((problem) => problem.includes('DATABASE_URL')));
  assert.ok(problems.some((problem) => problem.includes('WEB_ORIGIN')));
  assert.ok(problems.some((problem) => problem.includes('JWT_ACCESS_SECRET')));
});

test('production: rejects public default / short JWT secrets', () => {
  assert.equal(
    problemsOf({ ...productionBase, JWT_ACCESS_SECRET: 'change-me-in-production' }).length,
    1,
  );
  assert.equal(problemsOf({ ...productionBase, JWT_ACCESS_SECRET: 'short-secret' }).length, 1);
});

test('production: origins must be exact https origins, never *', () => {
  assert.equal(problemsOf({ ...productionBase, WEB_ORIGIN: '*' }).length, 1);
  assert.equal(problemsOf({ ...productionBase, WEB_ORIGIN: 'http://example.com' }).length, 1);
  assert.equal(problemsOf({ ...productionBase, WEB_ORIGIN: 'https://example.com/app' }).length, 1);
  const environment = loadEnvironment({
    ...productionBase,
    WEB_ORIGIN: 'https://a.example.com/, https://b.example.com',
  });
  assert.deepEqual(environment.webOrigins, ['https://a.example.com', 'https://b.example.com']);
});

test('cookie: SameSite=None requires Secure; custom domain setup can use Lax', () => {
  assert.ok(problemsOf({ ...productionBase, REFRESH_COOKIE_SECURE: 'false' }).length >= 1);
  const sameSiteSetup = loadEnvironment({ ...productionBase, REFRESH_COOKIE_SAME_SITE: 'lax' });
  assert.deepEqual(sameSiteSetup.refreshCookie, {
    sameSite: 'lax',
    secure: true,
    partitioned: false,
  });
});

test('trust proxy: hop count / names parsed; "true" is rejected in production', () => {
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(problemsOf({ ...productionBase, TRUST_PROXY: 'true' }).length, 1);
  assert.equal(loadEnvironment({ ...productionBase, TRUST_PROXY: '1' }).trustProxy, 1);
});

test('admin key and numeric limits are validated', () => {
  assert.equal(problemsOf({ ...productionBase, ADMIN_API_KEY: 'too-short' }).length, 1);
  assert.equal(problemsOf({ ...productionBase, AGGREGATION_DEMO_COOLDOWN_MS: '-5' }).length, 1);
  assert.equal(problemsOf({ ...productionBase, MAX_BODY_SIZE: 'huge' }).length, 1);
});
