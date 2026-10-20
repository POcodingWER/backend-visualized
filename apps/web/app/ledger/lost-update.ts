import type { PointSimulationResult } from './api';

/**
 * "왜 15,000P가 아닐까요?" 설명에 쓰는 숫자. 화면에 적는 숫자는 모두 실행 결과(traces)에서 센다.
 * shouldBe = 시작 잔액 + 적립 합 − 사용 합 (모두 셌다면 있어야 할 잔액), endedAt = 실제로 남은 잔액 칸.
 */
export function explainLostUpdate(result: PointSimulationResult) {
  const applied = result.traces.filter((trace) => trace.outcome === 'applied');
  const earns = applied.filter((trace) => trace.amount > 0);
  const spends = applied.filter((trace) => trace.amount < 0);
  const earned = earns.reduce((sum, trace) => sum + trace.amount, 0);
  const spent = -spends.reduce((sum, trace) => sum + trace.amount, 0);
  const lastWriter = applied.reduce<(typeof applied)[number] | null>(
    (last, trace) => (last === null || trace.wroteAtMs > last.wroteAtMs ? trace : last),
    null,
  );
  const shouldBe = result.openingBalance + earned - spent;
  return {
    opening: result.openingBalance,
    earnCount: earns.length,
    spendCount: spends.length,
    pointsEach: Math.abs(result.traces[0]?.amount ?? 0),
    earned,
    spent,
    shouldBe,
    endedAt: result.reconciliation.balance,
    lost: shouldBe - result.reconciliation.balance,
    /** 시작 잔액을 그대로 읽은 요청 수 (덮어쓰기에서 같은 옛 잔액을 본 사람) */
    readOpening: result.traces.filter((trace) => trace.balanceSeen === result.openingBalance)
      .length,
    lastWriter,
  };
}
