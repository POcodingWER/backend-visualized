/** 기다리기 (데모의 가짜 PG 대기, 재시도 간격, 폴링) */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 0.1ms 단위로 반올림 (화면 타임라인에 쓰는 시각) */
export const roundToTenth = (value: number) => Math.round(value * 10) / 10;

/** 지금부터 잰다. 돌려준 함수를 부를 때마다 시작 후 경과 ms (0.1ms 단위) */
export function startStopwatch(): () => number {
  const startedAt = performance.now();
  return () => roundToTenth(performance.now() - startedAt);
}
