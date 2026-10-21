/** 타임라인에 그리는 요청 한 건 */
export interface RequestLogEntry {
  id: number;
  at: number;
  actor: 'user' | 'attacker';
  label: string;
  /** 어떤 토큰을 들고 갔는지 (예: AT#3, RT 쿠키) */
  credential: string;
  status: number;
  reason?: string;
  durationMs: number;
  note?: string;
}

export type AddLogEntry = (entry: Omit<RequestLogEntry, 'id' | 'at'>) => void;

/** 손목밴드를 보여주고 놀이기구를 탄 결과 (GET /auth/me, 만료면 재발급 후 한 번 더) */
export type RideResult = 'passed' | 'refreshed' | 'kicked-out';
