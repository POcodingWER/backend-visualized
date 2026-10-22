import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { pickRequestId, REQUEST_ID_HEADER } from './request-id';

/** 로그에 절대 남기지 않을 값: 로그인 토큰, 쿠키, 관리자 키, 비밀번호 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-admin-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

/** 요청마다 번호를 정하고(들어온 x-request-id가 있으면 그것), 응답 헤더에도 같은 번호를 실어 보낸다 */
export function assignRequestId(request: IncomingMessage, response: ServerResponse): string {
  const requestId = pickRequestId(request.headers[REQUEST_ID_HEADER]);
  response.setHeader(REQUEST_ID_HEADER, requestId);
  return requestId;
}

/**
 * pino 설정. 운영은 한 줄 JSON(나중에 검색·집계하기 쉽게), 개발은 사람이 읽기 좋은 pino-pretty.
 * /health는 Docker·배포 스크립트가 몇 초마다 부르므로 요청 로그에서 뺀다.
 * 요청 한 줄에는 방법·주소·상태 코드·걸린 시간만 남긴다. 헤더 전체와 접속 IP는 디스크만 먹고
 * 개인 정보라서 뺀다 (서버 로그는 10MB × 5개만 보관).
 */
export function loggerParams(isProduction: boolean): Params {
  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? 'info',
      genReqId: assignRequestId,
      customProps: (request) => ({ requestId: request.id }),
      autoLogging: { ignore: (request) => request.url === '/health' },
      serializers: {
        req: (request: { id: unknown; method: string; url: string }) => ({
          id: request.id,
          method: request.method,
          url: request.url,
        }),
        res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
      },
      redact: { paths: REDACTED_PATHS, censor: '[가림]' },
      transport: isProduction
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true, ignore: 'pid,hostname' } },
    },
  };
}
