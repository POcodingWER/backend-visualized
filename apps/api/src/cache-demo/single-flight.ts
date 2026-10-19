/**
 * single-flight: 같은 작업이 진행 중이면 새로 시작하지 않고 진행 중인 Promise를 공유한다.
 * ponytail: apps/web/lib/single-flight.ts(2장 토큰 갱신)와 같은 코드. API는 CommonJS, 웹 SDK 패키지는 ESM이라
 * 한 파일을 같이 import할 수 없어 복사해 둔다 — 공용 패키지를 CJS/ESM 겸용으로 빌드하게 되면 합칠 것.
 */
export function createSingleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    inFlight ??= task().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
