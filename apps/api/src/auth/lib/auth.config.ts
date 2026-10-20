import type { CookieOptions } from 'express';
import { appEnvironment } from '../../common/config/app-environment';

/** 인증 데모 설정. 값은 config/environment.ts에서 검증된 환경 변수에서 온다 */
export const authConfig = {
  accessTokenSecret: appEnvironment.jwtAccessSecret,
  /** 데모에서 만료를 눈으로 보기 위해 짧게 (기본 20초) */
  accessTokenTtlSeconds: appEnvironment.accessTokenTtlSeconds,
  refreshTokenTtlSeconds: appEnvironment.refreshTokenTtlSeconds,
  refreshCookieName: 'bv_refresh_token',
  /** 리프레시 쿠키는 /auth 경로에만 전송 */
  refreshCookiePath: '/auth',
  /** 토큰 탈취 시뮬레이션 같은 데모 전용 엔드포인트 */
  demoEndpointsEnabled: appEnvironment.authDemoEndpointsEnabled,
};

/**
 * 리프레시 쿠키 속성. 설정과 삭제에 같은 속성을 써야 브라우저가 같은 쿠키로 인식한다 (특히 Partitioned).
 * - 같은 사이트(app.example.com ↔ api.example.com, 또는 localhost 포트끼리): SameSite=Lax
 * - 다른 사이트(*.vercel.app ↔ api.example.com): SameSite=None; Secure (+ Partitioned)
 */
export function refreshCookieOptions(): CookieOptions {
  const { sameSite, secure, partitioned } = appEnvironment.refreshCookie;
  return {
    httpOnly: true,
    sameSite,
    secure,
    ...(partitioned && { partitioned: true }),
    path: authConfig.refreshCookiePath,
  };
}

/** 서버 시작 시 upsert 되는 데모 계정 */
export const DEMO_USERS = [
  { username: 'demo', password: 'demo1234', displayName: '데모 사용자' },
  { username: 'alice', password: 'alice1234', displayName: '앨리스' },
];
