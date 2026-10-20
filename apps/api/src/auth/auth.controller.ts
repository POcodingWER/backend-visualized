import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AccessTokenGuard, type AuthenticatedRequest } from './lib/access-token.guard';
import { authConfig, refreshCookieOptions } from './lib/auth.config';
import { readCookie } from './lib/cookies';
import { LoginDto, RefreshDto } from './dto/auth.dto';
import { authError, AuthService, toPublicTokenRow } from './auth.service';

/** 2장 손목밴드: 액세스/리프레시 토큰 데모. 쿠키 읽기·쓰기는 여기서, 토큰 판단은 AuthService에서 */
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.login(dto.username, dto.password, dto.accessTokenTtlSeconds);
    this.setRefreshCookie(response, session.refreshToken);
    return {
      user: session.user,
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshToken: toPublicTokenRow(session.refreshTokenRecord),
    };
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@Req() request: AuthenticatedRequest) {
    const payload = request.accessTokenPayload!;
    return {
      userId: payload.sub,
      username: payload.username,
      familyId: payload.familyId,
      issuedAt: new Date((payload.iat ?? 0) * 1000).toISOString(),
      expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
      serverTime: new Date().toISOString(),
    };
  }

  /** 리프레시 토큰 회전. 쿠키(정상 사용자) 또는 본문(공격자 시뮬레이션)으로 토큰을 받는다 */
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 10_000 } })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const fromBody = dto.refreshToken !== undefined;
    if (fromBody && !authConfig.demoEndpointsEnabled) throw new ForbiddenException();
    const rawToken =
      dto.refreshToken ?? readCookie(request.headers.cookie, authConfig.refreshCookieName);
    try {
      const session = await this.auth.refresh(rawToken, dto.accessTokenTtlSeconds);
      // 본문으로 온 요청(공격자)에는 쿠키를 심지 않고 토큰 원문을 돌려준다 (데모)
      if (fromBody) {
        return {
          accessToken: session.accessToken,
          accessTokenExpiresAt: session.accessTokenExpiresAt,
          refreshToken: toPublicTokenRow(session.refreshTokenRecord),
          rotatedRefreshTokenValue: session.refreshToken,
        };
      }
      this.setRefreshCookie(response, session.refreshToken);
      return {
        user: session.user,
        accessToken: session.accessToken,
        accessTokenExpiresAt: session.accessTokenExpiresAt,
        refreshToken: toPublicTokenRow(session.refreshTokenRecord),
      };
    } catch (error) {
      if (!fromBody) this.clearRefreshCookie(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const rawToken = readCookie(request.headers.cookie, authConfig.refreshCookieName);
    this.clearRefreshCookie(response);
    return this.auth.logout(rawToken);
  }

  /** 한 로그인(패밀리)의 회전 체인. familyId는 추측 불가능한 UUID (데모용 공개 조회) */
  @Get('families/:familyId')
  async family(@Param('familyId', new ParseUUIDPipe()) familyId: string) {
    const tokens = await this.auth.familyChain(familyId);
    if (tokens.length === 0) throw new NotFoundException('family not found');
    return { familyId, tokens };
  }

  /** 데모: "공격자가 현재 리프레시 토큰을 훔쳤다" — 쿠키 값을 그대로 돌려줌 (운영에선 절대 금지) */
  @Post('demo/steal-refresh-token')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 10_000 } })
  async stealRefreshToken(@Req() request: Request) {
    if (!authConfig.demoEndpointsEnabled) throw new ForbiddenException();
    const rawToken = readCookie(request.headers.cookie, authConfig.refreshCookieName);
    const token = await this.auth.findActiveRefreshToken(rawToken);
    if (!rawToken || !token)
      throw authError('refresh_token_missing', '훔칠 활성 리프레시 토큰이 없습니다');
    return { stolenRefreshTokenValue: rawToken, refreshToken: toPublicTokenRow(token) };
  }

  /** 데모: 서명은 맞지만 이미 만료된 액세스 토큰 (동시 요청 문제 재현용). 활성 리프레시 쿠키 필요 */
  @Post('demo/expired-access-token')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 10_000 } })
  async expiredAccessToken(@Req() request: Request) {
    if (!authConfig.demoEndpointsEnabled) throw new ForbiddenException();
    const rawToken = readCookie(request.headers.cookie, authConfig.refreshCookieName);
    return { accessToken: await this.auth.expiredAccessTokenFor(rawToken) };
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(authConfig.refreshCookieName, refreshToken, {
      ...refreshCookieOptions(),
      maxAge: authConfig.refreshTokenTtlSeconds * 1000,
    });
  }

  private clearRefreshCookie(response: Response) {
    response.clearCookie(authConfig.refreshCookieName, refreshCookieOptions());
  }
}
