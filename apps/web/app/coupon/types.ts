export type Strategy = 'none' | 'pessimistic' | 'optimistic' | 'atomic';
export type Outcome = 'issued' | 'sold_out' | 'retry_exhausted' | 'error';

/** POST /coupons/simulate → results[].requests[] */
export interface RequestTrace {
  requestId: number;
  userId: string;
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  success: boolean;
  result: Outcome;
  retries: number;
  oversold: boolean;
  issueSeq?: number;
  issueRowId?: string;
  poolWaitMs?: number;
  lockWaitMs?: number;
  affectedRows?: number;
  readIssuedCount?: number;
  errorMessage?: string;
}

export interface DbSnapshot {
  atMs: number;
  issuedCount: number;
  version: number;
  issueRows: number;
}

export interface Result {
  strategy: Strategy;
  couponName: string;
  couponId: number;
  users: number;
  quantity: number;
  durationMs: number;
  final: {
    issueRows: number;
    issuedCount: number;
    version: number;
    oversold: number;
    counterMismatch: boolean;
  };
  summary: Record<Outcome, number> & { totalRetries: number };
  dbSnapshots: DbSnapshot[];
  requests: RequestTrace[];
}

/** GET /coupons/:name/state */
export interface DbState {
  coupon: {
    id: number;
    name: string;
    totalQuantity: number;
    issuedCount: number;
    version: number;
    updatedAt: string;
  };
  issueRows: number;
  oversold: number;
  counterMismatch: boolean;
  recentIssues: {
    id: string;
    userId: string;
    strategy: string;
    createdAt: string;
    rank: number;
    oversold: boolean;
  }[];
}

export const OUTCOME_KO: Record<Outcome, string> = {
  issued: '발급 성공',
  sold_out: '품절로 거절',
  retry_exhausted: '재시도 한도 초과',
  error: '에러',
};
export const OUTCOME_COLOR: Record<Outcome, string> = {
  issued: '#34d399',
  sold_out: '#8b93b0',
  retry_exhausted: '#22d3ee',
  error: '#fb7185',
};
