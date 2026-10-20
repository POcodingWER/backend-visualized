import { callApi, FriendlyError } from '../../lib/api';
import type { DbState, Result, Strategy } from './types';

/** 1장 티켓팅 API: 선착순 쿠폰 시뮬레이션 실행 + 쿠폰 DB 상태 조회 */
export async function runSimulation(body: {
  users: number;
  quantity: number;
  strategy?: Strategy;
}): Promise<Result[]> {
  const response = await callApi<{
    results: Result[];
    reason?: string;
    retryAfterSeconds?: number;
  }>('/coupons/simulate', { json: body });
  if (response.status === 429) {
    throw new FriendlyError(
      response.body.reason === 'simulation_cooldown'
        ? `방금 다른 실험이 끝났어요. ${response.body.retryAfterSeconds ?? '몇'}초 뒤에 다시 눌러 주세요.`
        : '너무 자주 눌렀어요. 10초쯤 쉬었다가 다시 눌러 주세요.',
    );
  }
  if (response.status === 409) {
    throw new FriendlyError('지금 다른 사람이 실험을 돌리고 있어요. 몇 초 뒤에 다시 눌러 주세요.');
  }
  if (!response.ok) throw new FriendlyError(`실험이 실패했어요 (서버 응답 ${response.status}).`);
  return response.body.results;
}

/** 쿠폰 행 + 최근 발급 행. 못 읽으면 null (패널을 비워 둔다) */
export async function loadCouponState(couponName: string): Promise<DbState | null> {
  try {
    const response = await callApi<DbState>(
      `/coupons/${encodeURIComponent(couponName)}/state?limit=10`,
    );
    return response.ok ? response.body : null;
  } catch {
    return null;
  }
}
