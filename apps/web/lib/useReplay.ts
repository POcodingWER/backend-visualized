import { useEffect, useState } from 'react';

/** 화면 갱신 간격. 재생은 rAF로 부드럽게, React 렌더는 이 간격마다만 */
export const TICK_MS = 100;

/**
 * 실측 타임라인 재생. 실제 걸린 시간을 2.5~6초로 맞춰 rAF로 돌리되 setState는 TICK_MS마다만.
 * 처음엔 끝난 상태(최종 결과)로 보여주고, play()를 부르면 처음부터 재생한다. 동작 줄이기 설정이면 바로 끝 상태.
 */
export function useReplay(result: { durationMs: number } | null) {
  const [elapsedMs, setElapsedMs] = useState(Number.POSITIVE_INFINITY);
  const [playCount, setPlayCount] = useState(0);
  const replayMs = result ? Math.min(6000, Math.max(2500, result.durationMs)) : 0;

  useEffect(() => {
    if (!result || playCount === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setElapsedMs(Number.POSITIVE_INFINITY);
      return;
    }
    const startedAt = performance.now();
    let lastRenderAt = -Infinity;
    let frameId = 0;
    const loop = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / replayMs);
      if (now - lastRenderAt >= TICK_MS || progress === 1) {
        lastRenderAt = now;
        setElapsedMs(progress * result.durationMs);
      }
      if (progress < 1) frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [result, replayMs, playCount]);

  const clampedElapsedMs = result ? Math.min(elapsedMs, result.durationMs) : 0;
  return {
    elapsedMs: clampedElapsedMs,
    replayMs,
    isDone: result ? clampedElapsedMs >= result.durationMs : false,
    play: () => setPlayCount((count) => count + 1),
  };
}
