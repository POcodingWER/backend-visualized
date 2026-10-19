import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient, RefreshToken } from '@prisma/client';

export type RotationFailureReason =
  /** DB에 없는 토큰 */
  | 'refresh_token_invalid'
  | 'refresh_token_expired'
  /** 이미 폐기된 패밀리의 토큰 */
  | 'refresh_token_revoked'
  /** 이미 회전(사용)된 토큰을 다시 제출 → 탈취로 간주하고 패밀리 전체 폐기 */
  | 'refresh_token_reuse_detected';

export type RotationResult =
  | {
      rotated: true;
      userId: number;
      familyId: string;
      refreshToken: string;
      tokenRecord: RefreshToken;
    }
  | { rotated: false; reason: RotationFailureReason; familyId?: string };

export const hashRefreshToken = (rawToken: string) =>
  createHash('sha256').update(rawToken).digest('hex');

/**
 * 리프레시 토큰 저장소: 원문은 클라이언트(쿠키)에만, DB에는 SHA-256 해시만.
 * 회전(rotation): 토큰을 쓸 때마다 status active → used 로 바꾸고 같은 familyId로 새 토큰 발급.
 * 재사용 감지: used 토큰이 다시 오면 누군가 옛 토큰을 들고 있다는 뜻 → familyId 전체 revoked.
 */
export class RefreshTokenStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlSeconds: number,
  ) {}

  /** 로그인: 새 패밀리의 첫 토큰 */
  async issueNewFamily(userId: number) {
    return this.createToken(userId, randomUUID(), null);
  }

  async rotate(rawToken: string): Promise<RotationResult> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
    });
    if (!existing) return { rotated: false, reason: 'refresh_token_invalid' };
    const familyId = existing.familyId;

    if (existing.status === 'revoked') {
      return { rotated: false, reason: 'refresh_token_revoked', familyId };
    }
    if (existing.status === 'used') {
      await this.revokeFamily(familyId, 'reuse_detected');
      return { rotated: false, reason: 'refresh_token_reuse_detected', familyId };
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.revokeFamily(familyId, 'expired');
      return { rotated: false, reason: 'refresh_token_expired', familyId };
    }

    // 동시에 같은 토큰으로 두 요청이 와도 active → used 전환은 한 요청만 성공 (조건부 UPDATE)
    const { count: claimed } = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, status: 'active' },
      data: { status: 'used', usedAt: new Date() },
    });
    if (claimed === 0) {
      await this.revokeFamily(familyId, 'reuse_detected');
      return { rotated: false, reason: 'refresh_token_reuse_detected', familyId };
    }

    const next = await this.createToken(existing.userId, familyId, existing.id);
    return { rotated: true, userId: existing.userId, familyId, ...next };
  }

  /** 로그아웃 또는 탈취 감지: 패밀리의 active/used 토큰 전부 revoked */
  async revokeFamily(familyId: string, reason: string) {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { familyId, status: { not: 'revoked' } },
      data: { status: 'revoked', revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  /** 회전하지 않고 토큰 소유자만 확인 (데모 엔드포인트용) */
  async findActive(rawToken: string) {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
    });
    return token && token.status === 'active' && token.expiresAt.getTime() > Date.now()
      ? token
      : null;
  }

  async findFamily(familyId: string) {
    return this.prisma.refreshToken.findMany({
      where: { familyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async createToken(userId: number, familyId: string, parentId: string | null) {
    const refreshToken = randomBytes(32).toString('base64url');
    const tokenRecord = await this.prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        userId,
        familyId,
        parentId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      },
    });
    return { refreshToken, tokenRecord };
  }
}
