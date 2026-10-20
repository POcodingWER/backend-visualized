import type { RequestTrace, Result, Strategy } from './types';

export const QUANTITY = 100;
export const DEFAULT_USERS = 500;

/** 화면 갱신 주기 (매 프레임 setState 하지 않음) */
export { TICK_MS } from '../../lib/useReplay';

/** 지난 실측 기록 (public/data). 첫 화면을 빈 상태 없이 보여주기 위해 쓴다. */
export const RECORDED_RUN_URL = '/data/ticketing-recorded-run.json';
export type RecordedRun = {
  recordedAt: string;
  environment: string;
  request: { users: number; quantity: number };
  results: Result[];
};

/** 개발자용 정보 (DevDetails 안에서만 쓰는 용어) */
export const STRATEGY_INFO: Record<
  Strategy,
  { name: string; color: string; how: string; pro: string; con: string }
> = {
  none: {
    name: '제어 없음',
    color: '#A3321F',
    how: '남은 수량을 읽고 → 남았으면 발급하고 → 카운터를 (읽은 값 + 1)로 저장합니다.',
    pro: '가장 단순한 코드.',
    con: '여러 요청이 동시에 "아직 남았다"를 읽고 모두 통과 → 초과 발급. 카운터도 서로 덮어써서(lost update) 실제 발급 수와 어긋납니다.',
  },
  pessimistic: {
    name: '비관적 락',
    color: '#8E4F1F',
    how: '트랜잭션에서 SELECT … FOR UPDATE로 쿠폰 행을 잠그고, 락을 잡은 요청만 확인·발급합니다. 나머지는 줄을 서서 기다립니다.',
    pro: '정확함. 충돌이 잦아도 재시도 없이 순서대로 처리.',
    con: '모두가 한 줄로 서므로 처리량이 락 하나에 묶이고, 대기 중인 트랜잭션이 DB 커넥션을 붙잡습니다.',
  },
  optimistic: {
    name: '낙관적 락',
    color: '#345E72',
    how: 'version을 같이 읽고, UPDATE … WHERE version = 읽은값 으로 갱신합니다. 누가 먼저 바꿨으면 0행 → 다시 읽고 재시도.',
    pro: '락을 잡지 않아 충돌이 드문 데이터에선 가볍고 빠름.',
    con: '한 행에 수백 명이 몰리면 대부분 충돌 → 재시도 폭증. 재시도 한도(30회)를 넘기면 쿠폰이 남아도 실패합니다.',
  },
  atomic: {
    name: '원자적 UPDATE',
    color: '#44633D',
    how: 'UPDATE … SET issued = issued + 1 WHERE issued < total 한 문장으로 "확인 + 증가"를 DB가 한 번에 처리합니다.',
    pro: '정확하고 가장 빠름. 코드도 단순.',
    con: '조건이 한 문장으로 표현될 때만 가능. 복잡한 검증(1인 1매 등)은 unique 제약 등과 함께 써야 합니다.',
  },
};
export const STRATEGY_ORDER: Strategy[] = ['none', 'pessimistic', 'optimistic', 'atomic'];

/** 본문용 쉬운 비유 */
export const FIX_ANALOGY: Record<
  Exclude<Strategy, 'none'>,
  { title: string; story: string; tradeoff: string }
> = {
  pessimistic: {
    title: '줄 세우기',
    story: '매표소 창구를 하나만 열고, 한 사람씩 들어와서 남은 자리를 확인하고 표를 받게 해요.',
    tradeoff: '정확하지만, 모두가 한 줄로 기다려야 해요.',
  },
  optimistic: {
    title: '눈치 보고 재도전',
    story: '일단 다 같이 시도하고, 내가 보는 사이 누가 먼저 가져갔으면 처음부터 다시 해요.',
    tradeoff: '사람이 적을 땐 가볍지만, 몰리면 다시 하기가 폭증해요.',
  },
  atomic: {
    title: '한 번에 처리',
    story:
      '"자리 확인"과 "표 주기"를 매표소가 한 동작으로 끝내요. 그 사이에 누가 끼어들 틈이 없어요.',
    tradeoff: '가장 빠르고 정확해요. 조건이 단순할 때 쓸 수 있어요.',
  },
};

/** 실측 timeline을 경과 시각 elapsedMs에서 잘라 본 상태 */
export function replayStateAt(requests: RequestTrace[], elapsedMs: number) {
  let issued = 0,
    over = 0,
    rejected = 0,
    inflight = 0,
    retries = 0,
    recentRetry = 0;
  for (const request of requests) {
    if (request.startedAtMs > elapsedMs) continue;
    if (request.finishedAtMs <= elapsedMs) {
      if (request.success) {
        issued++;
        if (request.oversold) over++;
      } else rejected++;
      retries += request.retries;
    } else {
      inflight++;
      // 진행 중 요청의 재시도는 경과 비율만큼 진행됐다고 근사
      retries +=
        (request.retries * (elapsedMs - request.startedAtMs)) / Math.max(1, request.durationMs);
      recentRetry += request.retries > 0 ? 1 : 0;
    }
  }
  return { issued, over, rejected, inflight, retries: Math.round(retries), recentRetry };
}
