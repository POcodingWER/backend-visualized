import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { authError, AuthService, type AccessTokenPayload } from './auth.service';

export interface AuthenticatedRequest {
  headers: Record<string, string | undefined>;
  accessTokenPayload?: AccessTokenPayload;
}

/** Authorization: Bearer <access token> 검증 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token)
      throw authError('access_token_missing', '액세스 토큰이 없습니다');
    request.accessTokenPayload = await this.auth.verifyAccessToken(token);
    return true;
  }
}
