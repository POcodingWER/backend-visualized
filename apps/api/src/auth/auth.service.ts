import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { RefreshToken } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { authConfig, DEMO_USERS } from './auth.config';
import { hashPassword, verifyPassword } from './password';
import { RefreshTokenStore } from './refresh-token.store';

export interface AccessTokenPayload {
  /** user id */
  sub: number;
  username: string;
  /** 어느 로그인(패밀리)에서 발급됐는지 */
  familyId: string;
  iat?: number;
  exp?: number;
}

/** 인증 실패 응답 본문: 클라이언트가 원인을 구분할 수 있게 reason을 포함 */
export const authError = (reason: string, message: string, extra: Record<string, unknown> = {}) =>
  new UnauthorizedException({ statusCode: 401, reason, message, ...extra });

@Injectable()
export class AuthService implements OnModuleInit {
  readonly refreshTokens: RefreshTokenStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {
    this.refreshTokens = new RefreshTokenStore(prisma, authConfig.refreshTokenTtlSeconds);
  }

  /** 데모 계정 준비 (이미 있으면 그대로) */
  async onModuleInit() {
    try {
      for (const demoUser of DEMO_USERS) {
        const exists = await this.prisma.user.findUnique({
          where: { username: demoUser.username },
        });
        if (exists) continue;
        await this.prisma.user.create({
          data: {
            username: demoUser.username,
            displayName: demoUser.displayName,
            passwordHash: await hashPassword(demoUser.password),
          },
        });
      }
    } catch {
      // DB가 꺼져 있어도 서버는 뜨도록 (health가 down 보고)
    }
  }

  async login(username: string, password: string, accessTokenTtlSeconds?: number) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw authError('invalid_credentials', '아이디 또는 비밀번호가 올바르지 않습니다');
    }
    const { refreshToken, tokenRecord } = await this.refreshTokens.issueNewFamily(user.id);
    return {
      user: { id: user.id, username: user.username, displayName: user.displayName },
      refreshToken,
      refreshTokenRecord: tokenRecord,
      ...(await this.signAccessToken(
        { sub: user.id, username: user.username, familyId: tokenRecord.familyId },
        accessTokenTtlSeconds,
      )),
    };
  }

  async refresh(rawRefreshToken: string | undefined, accessTokenTtlSeconds?: number) {
    if (!rawRefreshToken) throw authError('refresh_token_missing', '리프레시 토큰이 없습니다');
    const rotation = await this.refreshTokens.rotate(rawRefreshToken);
    if (!rotation.rotated) {
      throw authError(rotation.reason, REASON_MESSAGES[rotation.reason], {
        familyId: rotation.familyId,
      });
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: rotation.userId } });
    return {
      user: { id: user.id, username: user.username, displayName: user.displayName },
      refreshToken: rotation.refreshToken,
      refreshTokenRecord: rotation.tokenRecord,
      ...(await this.signAccessToken(
        { sub: user.id, username: user.username, familyId: rotation.familyId },
        accessTokenTtlSeconds,
      )),
    };
  }

  async signAccessToken(
    payload: AccessTokenPayload,
    ttlSeconds = authConfig.accessTokenTtlSeconds,
  ) {
    const accessToken = await this.jwt.signAsync(
      { sub: payload.sub, username: payload.username, familyId: payload.familyId },
      { secret: authConfig.accessTokenSecret, expiresIn: ttlSeconds },
    );
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /** 데모: 서명은 올바르지만 이미 만료된 액세스 토큰 */
  async signExpiredAccessToken(payload: AccessTokenPayload) {
    const issuedAt = Math.floor(Date.now() / 1000) - 60;
    return this.jwt.signAsync(
      {
        sub: payload.sub,
        username: payload.username,
        familyId: payload.familyId,
        iat: issuedAt,
        exp: issuedAt + 1,
      },
      { secret: authConfig.accessTokenSecret },
    );
  }

  async verifyAccessToken(accessToken: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(accessToken, {
        secret: authConfig.accessTokenSecret,
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw expired
        ? authError('access_token_expired', '액세스 토큰이 만료되었습니다')
        : authError('access_token_invalid', '액세스 토큰이 올바르지 않습니다');
    }
  }

  async findUser(userId: number) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }

  async familyChain(familyId: string) {
    const tokens = await this.refreshTokens.findFamily(familyId);
    return tokens.map(toPublicTokenRow);
  }
}

const REASON_MESSAGES: Record<string, string> = {
  refresh_token_invalid: '알 수 없는 리프레시 토큰입니다',
  refresh_token_expired: '리프레시 토큰이 만료되었습니다',
  refresh_token_revoked: '이미 폐기된 로그인입니다 (다시 로그인 필요)',
  refresh_token_reuse_detected:
    '이미 사용된 리프레시 토큰이 다시 제출되어 이 로그인의 모든 토큰을 폐기했습니다',
};

/** 해시는 노출하지 않고 시각화에 필요한 필드만 */
export function toPublicTokenRow(token: RefreshToken) {
  return {
    id: token.id,
    familyId: token.familyId,
    parentId: token.parentId,
    status: token.status,
    revokedReason: token.revokedReason,
    createdAt: token.createdAt,
    usedAt: token.usedAt,
    revokedAt: token.revokedAt,
    expiresAt: token.expiresAt,
  };
}
