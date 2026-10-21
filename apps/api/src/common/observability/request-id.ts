import { randomUUID } from 'node:crypto';

/** 요청 하나를 따라가는 번호. 응답 헤더로 돌려주고, 그 요청의 모든 로그 줄과 Sentry 이벤트에 붙인다 */
export const REQUEST_ID_HEADER = 'x-request-id';

// 밖에서 보낸 값은 짧고 안전한 글자일 때만 그대로 쓴다 (로그에 이상한 글자가 끼지 않게)
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function pickRequestId(incoming: string | string[] | undefined): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return value && SAFE_REQUEST_ID.test(value) ? value : randomUUID();
}
