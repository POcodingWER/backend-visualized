import { API_URL } from './api';

/** /auth 응답에 공통으로 오는 리프레시 토큰 행 (해시 제외) */
export interface RefreshTokenRow {
  id: string;
  familyId: string;
  parentId: string | null;
  status: 'active' | 'used' | 'revoked';
  revokedReason: string | null;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
}

export interface Session {
  user: { id: number; username: string; displayName: string };
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: RefreshTokenRow;
}

export interface ApiResult<Body> {
  status: number;
  ok: boolean;
  body: Body;
  durationMs: number;
}

export interface AuthErrorBody {
  statusCode: number;
  reason?: string;
  message?: string | string[];
  familyId?: string;
}

/** 리프레시 쿠키를 주고받도록 항상 credentials: 'include' */
async function call<Body>(path: string, init: RequestInit = {}): Promise<ApiResult<Body>> {
  const startedAt = performance.now();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as Body;
  return {
    status: response.status,
    ok: response.ok,
    body,
    durationMs: performance.now() - startedAt,
  };
}

export const authApi = {
  login: (username: string, password: string, accessTokenTtlSeconds: number) =>
    call<Session | AuthErrorBody>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, accessTokenTtlSeconds }),
    }),
  me: (accessToken: string) =>
    call<{ username: string; expiresAt: string } | AuthErrorBody>('/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  /** 정상 사용자: httpOnly 쿠키로 회전 */
  refresh: (accessTokenTtlSeconds: number) =>
    call<Session | AuthErrorBody>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ accessTokenTtlSeconds }),
    }),
  /** 공격자 시뮬레이션: 훔친 토큰을 본문으로 제출 */
  refreshWithStolenToken: (refreshToken: string) =>
    call<(Session & { rotatedRefreshTokenValue: string }) | AuthErrorBody>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),
  logout: () => call<{ revokedTokens: number }>('/auth/logout', { method: 'POST' }),
  family: (familyId: string) =>
    call<{ familyId: string; tokens: RefreshTokenRow[] } | AuthErrorBody>(
      `/auth/families/${familyId}`,
    ),
  stealRefreshToken: () =>
    call<{ stolenRefreshTokenValue: string; refreshToken: RefreshTokenRow } | AuthErrorBody>(
      '/auth/demo/steal-refresh-token',
      { method: 'POST' },
    ),
  expiredAccessToken: () =>
    call<{ accessToken: string } | AuthErrorBody>('/auth/demo/expired-access-token', {
      method: 'POST',
    }),
};

export const isSession = (body: unknown): body is Session =>
  typeof body === 'object' && body !== null && 'accessToken' in body;

export const errorReason = (body: unknown): string =>
  (typeof body === 'object' &&
    body !== null &&
    'reason' in body &&
    String((body as AuthErrorBody).reason)) ||
  '';

/** 토큰을 화면에 보여줄 때 앞뒤만 */
export const shortToken = (token: string) => `${token.slice(0, 10)}…${token.slice(-6)}`;

export const REASON_KO: Record<string, string> = {
  access_token_expired: '액세스 토큰 만료',
  access_token_invalid: '액세스 토큰 위조/손상',
  access_token_missing: '액세스 토큰 없음',
  refresh_token_missing: '리프레시 토큰 없음',
  refresh_token_invalid: '알 수 없는 리프레시 토큰',
  refresh_token_expired: '리프레시 토큰 만료',
  refresh_token_revoked: '폐기된 로그인',
  refresh_token_reuse_detected: '재사용 감지 → 패밀리 전체 폐기',
  invalid_credentials: '아이디/비밀번호 오류',
};
