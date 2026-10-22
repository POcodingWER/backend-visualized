/** API 서버 주소. 배포 땐 NEXT_PUBLIC_API_URL로 바꾼다 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface ApiResult<Body> {
  status: number;
  ok: boolean;
  body: Body;
  durationMs: number;
  instanceId?: string;
}

/** 화면에 그대로 보여줘도 되는 쉬운 오류 문장 */
export class FriendlyError extends Error {}

export const CONNECTION_FAILED = '서버에 연결하지 못했어요. 잠시 후 다시 눌러 주세요.';

/**
 * API 호출 한 번. 각 장의 api.ts만 이 함수를 쓰고, 화면 컴포넌트는 장별 api.ts 함수를 부른다.
 * - json을 주면 POST 본문(JSON)으로 보낸다. GET은 캐시를 끈다(데모 값은 매번 새로 읽어야 한다).
 *   POST는 원래 캐시되지 않고, no-store를 붙이면 Chrome이 CORS 사전 확인(OPTIONS)을 기억하지 않고 매번 다시 보낸다.
 * - 4xx/5xx도 던지지 않고 status와 body를 돌려준다. 상태 코드별 문장은 장마다 다르므로 호출한 쪽이 고른다.
 * - 네트워크 오류(서버 꺼짐 등)만 FriendlyError로 던진다.
 */
export async function callApi<Body>(
  path: string,
  { json, headers, ...init }: RequestInit & { json?: unknown } = {},
): Promise<ApiResult<Body>> {
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...(json === undefined
        ? { cache: 'no-store' as const }
        : { method: 'POST', body: JSON.stringify(json) }),
      ...init,
      headers: {
        ...(json !== undefined && { 'Content-Type': 'application/json' }),
        ...(headers as Record<string, string> | undefined),
      },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new FriendlyError(CONNECTION_FAILED);
  }
  const body = (await response.json().catch(() => ({}))) as Body;
  return {
    status: response.status,
    ok: response.ok,
    body,
    durationMs: performance.now() - startedAt,
    instanceId: response.headers.get('x-instance-id') ?? undefined,
  };
}

/** 성공 응답의 body만 필요할 때. 실패면 failedMessage(status)로 FriendlyError를 던진다 */
export async function requireOk<Body>(
  request: Promise<ApiResult<unknown>>,
  failedMessage: (status: number) => string = (status) => `서버 오류 (${status})`,
): Promise<Body> {
  const result = await request;
  if (!result.ok) throw new FriendlyError(failedMessage(result.status));
  return result.body as Body;
}
