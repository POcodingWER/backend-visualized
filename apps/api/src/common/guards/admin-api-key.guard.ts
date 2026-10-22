import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { appEnvironment } from '../config/app-environment';
import type { AppEnvironment } from '../config/environment';

const ADMIN_API_KEY_HEADER = 'x-admin-api-key';

/** 길이와 무관하게 일정 시간에 비교 (해시 후 timingSafeEqual) */
export function isSameSecret(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * 관리자 API 보호: X-Admin-Api-Key 헤더가 ADMIN_API_KEY와 같아야 통과.
 * ADMIN_API_KEY 미설정 시 개발에선 허용, 운영에선 차단 (키 없이 열리는 일이 없도록).
 */
@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  /** 테스트에서 바꿔 끼울 수 있게 필드로 둔다 */
  environment: Pick<AppEnvironment, 'adminApiKey' | 'isProduction'> = appEnvironment;

  canActivate(context: ExecutionContext): boolean {
    const expectedKey = this.environment.adminApiKey;
    if (!expectedKey) {
      if (!this.environment.isProduction) return true;
      throw new ForbiddenException({
        statusCode: 403,
        reason: 'admin_api_disabled',
        message: 'ADMIN_API_KEY가 설정되지 않아 관리자 API가 꺼져 있습니다',
      });
    }
    const request = context.switchToHttp().getRequest<Request>();
    const providedKey = request.headers[ADMIN_API_KEY_HEADER];
    if (typeof providedKey !== 'string' || !isSameSecret(providedKey, expectedKey))
      throw new UnauthorizedException({
        statusCode: 401,
        reason: 'admin_api_key_invalid',
        message: `${ADMIN_API_KEY_HEADER} 헤더가 없거나 올바르지 않습니다`,
      });
    return true;
  }
}
