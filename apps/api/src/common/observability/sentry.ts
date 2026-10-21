import { Logger } from '@nestjs/common';

type SentryApi = typeof import('@sentry/node');

/** SENTRY_DSN이 있을 때만 불러온다. 없으면 패키지를 읽지도 않아서 메모리도 안 쓴다 */
let sentry: SentryApi | null = null;

export async function initSentry(dsn: string | null, environment: string): Promise<boolean> {
  if (!dsn) return false;
  sentry = await import('@sentry/node');
  // 오류만 보낸다. 성능 추적(트레이스)은 끈다 (개인 정보 전송은 Sentry 기본값이 꺼짐)
  sentry.init({ dsn, environment, tracesSampleRate: 0 });
  new Logger('Sentry').log('Sentry 켜짐 (오류만 전송)');
  return true;
}

/** 예상하지 못한 오류(500)를 Sentry로. 같은 요청의 로그를 찾을 수 있게 request_id 태그를 붙인다 */
export function reportToSentry(error: unknown, requestId: string) {
  if (!sentry) return;
  const api = sentry;
  api.withScope((scope) => {
    scope.setTag('request_id', requestId);
    api.captureException(error);
  });
}
