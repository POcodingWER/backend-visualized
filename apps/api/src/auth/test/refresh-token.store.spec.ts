/**
 * 리프레시 토큰 회전·재사용 감지 통합 테스트 (실제 MySQL, apps/api/.env). DB가 없으면 skip.
 * 테스트용 사용자는 끝나면 삭제 (토큰은 cascade 삭제).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { RefreshTokenStore } from '../lib/refresh-token.store';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env 없음 → skip
  }
}

describe('RefreshTokenStore rotation (MySQL)', () => {
  const prisma = new PrismaClient();
  const store = new RefreshTokenStore(prisma, 3600);
  let databaseUp = false;
  let userId = 0;

  before(async () => {
    try {
      const user = await prisma.user.create({
        data: {
          username: `test-auth-${randomUUID().slice(0, 8)}`,
          displayName: 'test',
          passwordHash: 'x:y',
        },
      });
      userId = user.id;
      databaseUp = true;
    } catch (error) {
      // CI(REQUIRE_DATABASE=true)에선 DB가 없으면 skip하지 말고 실패
      if (process.env.REQUIRE_DATABASE === 'true') throw error;
      databaseUp = false;
    }
  });
  after(async () => {
    if (databaseUp) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('rotation: each refresh marks the old token used and issues a child in the same family', async (testContext) => {
    if (!databaseUp) return testContext.skip('DB unavailable');
    const first = await store.issueNewFamily(userId);
    const second = await store.rotate(first.refreshToken);
    assert.ok(second.rotated);
    if (!second.rotated) return;
    assert.equal(second.familyId, first.tokenRecord.familyId);
    assert.equal(second.tokenRecord.parentId, first.tokenRecord.id);
    const third = await store.rotate(second.refreshToken);
    assert.ok(third.rotated);
    const chain = await store.findFamily(first.tokenRecord.familyId);
    assert.deepEqual(
      chain.map((token) => token.status),
      ['used', 'used', 'active'],
    );
  });

  test('reuse detection: submitting an already-used token revokes the whole family', async (testContext) => {
    if (!databaseUp) return testContext.skip('DB unavailable');
    const first = await store.issueNewFamily(userId);
    const stolenCopy = first.refreshToken;
    const legitimate = await store.rotate(first.refreshToken);
    assert.ok(legitimate.rotated);
    if (!legitimate.rotated) return;

    const attacker = await store.rotate(stolenCopy);
    assert.deepEqual(attacker, {
      rotated: false,
      reason: 'refresh_token_reuse_detected',
      familyId: first.tokenRecord.familyId,
    });
    // 정상 사용자의 최신 토큰도 폐기되어 더는 못 쓴다
    const userAfterTheft = await store.rotate(legitimate.refreshToken);
    assert.equal(userAfterTheft.rotated, false);
    if (!userAfterTheft.rotated) assert.equal(userAfterTheft.reason, 'refresh_token_revoked');
    const chain = await store.findFamily(first.tokenRecord.familyId);
    assert.ok(chain.every((token) => token.status === 'revoked'));
    assert.ok(chain.every((token) => token.revokedReason === 'reuse_detected'));
  });

  test('concurrent refresh with the same token: exactly one rotates, the rest are treated as reuse', async (testContext) => {
    if (!databaseUp) return testContext.skip('DB unavailable');
    const first = await store.issueNewFamily(userId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.rotate(first.refreshToken)),
    );
    assert.equal(results.filter((result) => result.rotated).length, 1);
    assert.ok(
      results
        .filter((result) => !result.rotated)
        .every((result) => !result.rotated && result.reason === 'refresh_token_reuse_detected'),
    );
    const chain = await store.findFamily(first.tokenRecord.familyId);
    assert.ok(chain.every((token) => token.status === 'revoked'));
  });

  test('unknown token is rejected without touching any family', async (testContext) => {
    if (!databaseUp) return testContext.skip('DB unavailable');
    const result = await store.rotate('not-a-real-refresh-token-value');
    assert.deepEqual(result, { rotated: false, reason: 'refresh_token_invalid' });
  });
});
