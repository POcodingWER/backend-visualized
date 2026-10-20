import { callApi, FriendlyError, requireOk } from '../../lib/api';

/** 4장 포인트 통장 API (points 모듈) */

export type PointMode = 'overwrite' | 'ledger';

export interface PointRequestTrace {
  amount: number;
  startedAtMs: number;
  readAtMs: number;
  wroteAtMs: number;
  balanceSeen: number;
  balanceWritten: number;
  outcome: 'applied' | 'rejected';
}
export interface Reconciliation {
  balance: number;
  entriesSum: number;
  difference: number;
}
export interface PointSimulationResult {
  mode: PointMode;
  walletName: string;
  requests: number;
  openingBalance: number;
  expectedBalance: number;
  reconciliation: Reconciliation;
  lostPoints: number;
  rejected: number;
  durationMs: number;
  traces: PointRequestTrace[];
  overdraft?: { attemptedAmount: number; rejected: boolean };
}
export interface EntriesResponse {
  walletName: string;
  reconciliation: Reconciliation | null;
  entries: { id: string; amount: number; reason: string; createdAt: string }[];
}

/** 두 방식(덮어쓰기·통장)에 같은 적립·사용 requests건을 동시에 보낸다 */
export async function simulatePoints(requests: number): Promise<PointSimulationResult[]> {
  const response = await callApi<{ results: PointSimulationResult[] }>('/points/simulate', {
    json: { requests },
  });
  if (response.status === 429 || response.status === 409)
    throw new FriendlyError('방금 누가 실행했어요. 몇 초 뒤에 다시 눌러 주세요.');
  if (!response.ok) throw new FriendlyError(`서버 오류 (${response.status})`);
  return response.body.results;
}

/** 지갑 최근 내역 limit개 + 잔액·내역 합계 맞춰 보기 */
export const loadWalletEntries = (mode: PointMode, limit: number) =>
  requireOk<EntriesResponse>(callApi(`/points/${mode}/entries?limit=${limit}`));
