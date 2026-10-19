/** 인증 데모 설정. 모든 값은 환경 변수로 바꿀 수 있고, 로컬 개발용 기본값이 있다. */
export const authConfig = {
  accessTokenSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-change-me',
  /** 데모에서 만료를 눈으로 보기 위해 짧게 (기본 20초) */
  accessTokenTtlSeconds: Number(process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS ?? 20),
  refreshTokenTtlSeconds: Number(process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS ?? 86_400),
  refreshCookieName: 'bv_refresh_token',
  /** 리프레시 쿠키는 /auth 경로에만 전송 */
  refreshCookiePath: '/auth',
  /** 토큰 탈취 시뮬레이션 같은 데모 전용 엔드포인트 */
  demoEndpointsEnabled: process.env.AUTH_DEMO_ENDPOINTS !== 'false',
  secureCookie: process.env.NODE_ENV === 'production',
};

/** 서버 시작 시 upsert 되는 데모 계정 */
export const DEMO_USERS = [
  { username: 'demo', password: 'demo1234', displayName: '데모 사용자' },
  { username: 'alice', password: 'alice1234', displayName: '앨리스' },
];
