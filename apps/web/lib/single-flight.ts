/**
 * single-flight: 같은 작업이 진행 중이면 새로 시작하지 않고 진행 중인 Promise를 공유한다.
 * 토큰 갱신에 쓰면, 동시에 401을 받은 요청 N개가 refresh를 N번 부르지 않고 1번만 부른 뒤 결과를 나눠 쓴다.
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
