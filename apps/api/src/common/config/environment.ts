/**
 * 환경 변수 → 타입이 있는 설정 객체. 순수 함수라 테스트하기 쉽다.
 * 운영(NODE_ENV=production)에서는 위험한 기본값을 허용하지 않고, 문제를 한 번에 모두 모아 알려준다.
 */

export type CookieSameSite = 'lax' | 'strict' | 'none';
/** express `trust proxy` 값: false | 홉 수 | 'loopback' 같은 이름/IP/CIDR 목록 */
export type TrustProxySetting = boolean | number | string;

export interface RefreshCookieSettings {
  sameSite: CookieSameSite;
  secure: boolean;
  /** CHIPS: 최상위 사이트(웹 도메인)별로 분리 저장 → 서드파티 쿠키 차단 환경에서도 동작 (SameSite=None일 때) */
  partitioned: boolean;
}

export interface UsageLimitSettings {
  /** 모든 클라이언트를 합친 분당 이벤트 저장 한도 (0 = 무제한) */
  eventsPerMinuteGlobal: number;
  /** 레이트 리밋 체험용 엔드포인트의 전역 분당 한도 */
  rateLimitProbePerMinuteGlobal: number;
  /** 동시에 열 수 있는 SSE(/events/stream) 연결 수 */
  maxStreamConnections: number;
  /** 공개 집계 버튼(POST /events/demo/aggregate) 전역 쿨다운 */
  aggregationCooldownMs: number;
  /** 쿠폰 시뮬레이션이 끝난 뒤 다음 실행까지 전역 쿨다운 */
  couponSimulationCooldownMs: number;
}

export interface AppEnvironment {
  isProduction: boolean;
  port: number;
  databaseUrl: string | null;
  /** 6장 캐시 데모용 Redis. 개발 기본값은 docker-compose의 bv-redis(6380) */
  redisUrl: string;
  webOrigins: string[];
  trustProxy: TrustProxySetting;
  maxBodySize: string;
  jwtAccessSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  refreshCookie: RefreshCookieSettings;
  authDemoEndpointsEnabled: boolean;
  /** null이면: 개발에선 관리자 API 허용, 운영에선 관리자 API 비활성화 */
  adminApiKey: string | null;
  limits: UsageLimitSettings;
  /** 시작은 하되 로그로 알려줄 것들 */
  warnings: string[];
}

export class EnvironmentError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `환경 변수 설정 오류 ${problems.length}건:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'EnvironmentError';
  }
}

/** 저장소에 적혀 있는(=공개된) 개발용 비밀값. 운영에서 쓰면 누구나 토큰을 위조할 수 있다 */
export const PUBLIC_DEVELOPMENT_SECRETS = [
  'dev-only-access-secret-change-me',
  'change-me-in-production',
  'change-me',
  'secret',
];
export const DEVELOPMENT_JWT_SECRET = PUBLIC_DEVELOPMENT_SECRETS[0];
const MIN_JWT_SECRET_LENGTH = 32;
const MIN_ADMIN_API_KEY_LENGTH = 24;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function loadEnvironment(env: NodeJS.ProcessEnv): AppEnvironment {
  const problems: string[] = [];
  const warnings: string[] = [];
  const isProduction = env.NODE_ENV === 'production';
  const read = (name: string) => {
    const value = env[name]?.trim();
    return value ? value : undefined;
  };

  const integer = (name: string, fallback: number, minimum = 0): number => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum) {
      problems.push(`${name}=${raw}: ${minimum} 이상의 정수여야 합니다`);
      return fallback;
    }
    return value;
  };

  const boolean = (name: string, fallback: boolean): boolean => {
    const raw = read(name)?.toLowerCase();
    if (raw === undefined) return fallback;
    if (['true', '1', 'yes', 'on'].includes(raw)) return true;
    if (['false', '0', 'no', 'off'].includes(raw)) return false;
    problems.push(`${name}=${raw}: true 또는 false여야 합니다`);
    return fallback;
  };

  // ── 데이터베이스 ──
  const databaseUrl = read('DATABASE_URL') ?? null;
  if (!databaseUrl) {
    if (isProduction)
      problems.push('DATABASE_URL이 필요합니다 (예: mysql://user:password@host:3306/db)');
    else warnings.push('DATABASE_URL이 없습니다 — DB 연결이 실패합니다');
  } else if (!/^mysql:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL은 mysql:// 로 시작해야 합니다');
  }

  // ── Redis (6장 캐시) ──
  const configuredRedisUrl = read('REDIS_URL');
  if (!configuredRedisUrl && isProduction)
    problems.push('REDIS_URL이 필요합니다 (예: redis://redis:6379/0)');
  const redisUrl = configuredRedisUrl ?? 'redis://127.0.0.1:6380/0';
  if (!/^rediss?:\/\//.test(redisUrl))
    problems.push('REDIS_URL은 redis:// 또는 rediss:// 로 시작해야 합니다');

  // ── CORS 허용 출처 ──
  const rawOrigins = read('WEB_ORIGIN') ?? read('CORS_ORIGIN');
  if (!rawOrigins && isProduction)
    problems.push('WEB_ORIGIN이 필요합니다 (예: https://my-app.vercel.app, 여러 개면 쉼표로 구분)');
  const webOrigins = (rawOrigins ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const origin of webOrigins) {
    if (origin === '*') {
      problems.push('WEB_ORIGIN에 * 는 쓸 수 없습니다 (쿠키를 쓰는 CORS는 정확한 출처가 필요)');
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      problems.push(`WEB_ORIGIN의 "${origin}"은 올바른 URL이 아닙니다`);
      continue;
    }
    if (parsed.origin !== origin)
      problems.push(`WEB_ORIGIN의 "${origin}"에는 경로 없이 출처만 적어주세요 (${parsed.origin})`);
    if (isProduction && parsed.protocol !== 'https:' && !LOCAL_HOSTNAMES.has(parsed.hostname))
      problems.push(`WEB_ORIGIN의 "${origin}"은 운영에서 https여야 합니다`);
  }

  // ── 프록시 뒤 클라이언트 IP ──
  const trustProxy = parseTrustProxy(read('TRUST_PROXY'));
  if (trustProxy === true) {
    const message =
      'TRUST_PROXY=true는 클라이언트가 보낸 X-Forwarded-For를 그대로 믿어 IP 위조로 레이트 리밋을 우회할 수 있습니다. 프록시 홉 수(예: 1)나 IP/CIDR을 지정하세요';
    if (isProduction) problems.push(message);
    else warnings.push(message);
  }

  // ── 요청 본문 크기 ──
  const maxBodySize = read('MAX_BODY_SIZE') ?? '200kb';
  if (!/^\d+(b|kb|mb)$/i.test(maxBodySize))
    problems.push(`MAX_BODY_SIZE=${maxBodySize}: 100kb, 1mb 같은 형식이어야 합니다`);

  // ── JWT 비밀값 ──
  const configuredSecret = read('JWT_ACCESS_SECRET');
  const jwtAccessSecret = configuredSecret ?? DEVELOPMENT_JWT_SECRET;
  if (isProduction) {
    if (!configuredSecret)
      problems.push('JWT_ACCESS_SECRET이 필요합니다 (openssl rand -base64 48)');
    else if (PUBLIC_DEVELOPMENT_SECRETS.includes(configuredSecret))
      problems.push('JWT_ACCESS_SECRET이 저장소에 공개된 개발용 기본값입니다. 새 값을 생성하세요');
    else if (configuredSecret.length < MIN_JWT_SECRET_LENGTH)
      problems.push(`JWT_ACCESS_SECRET은 ${MIN_JWT_SECRET_LENGTH}자 이상이어야 합니다`);
  }

  // ── 리프레시 쿠키 ──
  const sameSiteRaw = (
    read('REFRESH_COOKIE_SAME_SITE') ?? (isProduction ? 'none' : 'lax')
  ).toLowerCase();
  let sameSite: CookieSameSite = 'lax';
  if (sameSiteRaw === 'lax' || sameSiteRaw === 'strict' || sameSiteRaw === 'none')
    sameSite = sameSiteRaw;
  else
    problems.push(`REFRESH_COOKIE_SAME_SITE=${sameSiteRaw}: lax, strict, none 중 하나여야 합니다`);
  const secure = boolean('REFRESH_COOKIE_SECURE', isProduction);
  const partitioned = boolean('REFRESH_COOKIE_PARTITIONED', sameSite === 'none');
  if (sameSite === 'none' && !secure)
    problems.push(
      'REFRESH_COOKIE_SAME_SITE=none이면 REFRESH_COOKIE_SECURE=true여야 합니다 (브라우저가 거부)',
    );
  if (partitioned && !secure)
    problems.push('REFRESH_COOKIE_PARTITIONED=true에는 Secure 쿠키가 필요합니다');
  if (isProduction && !secure) warnings.push('운영인데 리프레시 쿠키에 Secure가 꺼져 있습니다');

  // ── 데모 전용 엔드포인트 / 관리자 키 ──
  const authDemoEndpointsEnabled = boolean('AUTH_DEMO_ENDPOINTS', !isProduction);
  if (isProduction && authDemoEndpointsEnabled)
    warnings.push(
      'AUTH_DEMO_ENDPOINTS=true: 토큰 탈취 시뮬레이션 엔드포인트가 켜져 있습니다 (공개 데모 사이트용, 실서비스에선 false)',
    );
  const adminApiKey = read('ADMIN_API_KEY') ?? null;
  if (adminApiKey && isProduction && adminApiKey.length < MIN_ADMIN_API_KEY_LENGTH)
    problems.push(`ADMIN_API_KEY는 ${MIN_ADMIN_API_KEY_LENGTH}자 이상이어야 합니다`);
  if (!adminApiKey)
    warnings.push(
      isProduction
        ? 'ADMIN_API_KEY가 없어 /events/admin/* 관리자 API가 비활성화됩니다'
        : 'ADMIN_API_KEY가 없어 개발 모드에서는 /events/admin/* 를 키 없이 허용합니다',
    );

  const environment: AppEnvironment = {
    isProduction,
    port: integer('PORT', 4000, 1),
    databaseUrl,
    redisUrl,
    webOrigins,
    trustProxy,
    maxBodySize,
    jwtAccessSecret,
    accessTokenTtlSeconds: integer('AUTH_ACCESS_TOKEN_TTL_SECONDS', 20, 5),
    refreshTokenTtlSeconds: integer('AUTH_REFRESH_TOKEN_TTL_SECONDS', 86_400, 60),
    refreshCookie: { sameSite, secure, partitioned },
    authDemoEndpointsEnabled,
    adminApiKey,
    limits: {
      eventsPerMinuteGlobal: integer('EVENTS_GLOBAL_LIMIT_PER_MINUTE', 30_000),
      rateLimitProbePerMinuteGlobal: integer('RATE_LIMIT_DEMO_GLOBAL_LIMIT_PER_MINUTE', 20_000),
      maxStreamConnections: integer('MAX_STREAM_CONNECTIONS', 200),
      aggregationCooldownMs: integer('AGGREGATION_DEMO_COOLDOWN_MS', 10_000),
      couponSimulationCooldownMs: integer('COUPON_SIMULATION_COOLDOWN_MS', 3_000),
    },
    warnings,
  };
  if (problems.length > 0) throw new EnvironmentError(problems);
  return environment;
}

export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  if (raw === undefined || raw === '' || raw.toLowerCase() === 'false') return false;
  if (raw.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/** 시작 로그용 요약 (비밀값 제외) */
export function describeEnvironment(environment: AppEnvironment): string {
  const cookie = environment.refreshCookie;
  return [
    `mode=${environment.isProduction ? 'production' : 'development'}`,
    `webOrigins=${environment.webOrigins.join(',')}`,
    `trustProxy=${String(environment.trustProxy)}`,
    `maxBodySize=${environment.maxBodySize}`,
    `refreshCookie=SameSite=${cookie.sameSite}${cookie.secure ? '; Secure' : ''}${cookie.partitioned ? '; Partitioned' : ''}`,
    `authDemoEndpoints=${environment.authDemoEndpointsEnabled ? 'on' : 'off'}`,
    `adminApi=${environment.adminApiKey ? 'key required' : environment.isProduction ? 'disabled' : 'open (dev)'}`,
  ].join(' · ');
}
