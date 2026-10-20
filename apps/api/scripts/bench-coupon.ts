/**
 * 1장 티켓팅(쿠폰) 벤치마크 (docs/benchmarks/ticketing-coupon.md): 500명 vs 쿠폰 100장, 전략별 초과 발급/시간/재시도
 *
 *   pnpm --filter @bv/api bench:coupon                 # MODE=inproc (서버 프로세스 없이 Prisma 직접, 동시 Promise)
 *   MODE=http API_URL=http://localhost:4100 pnpm --filter @bv/api bench:coupon
 *     → 동시 HTTP 요청 USERS개를 POST /coupons/issue 로. rate limit을 피하려면 API를 THROTTLE_LIMIT=1000000 으로 실행
 *   USERS=500 QTY=100 RUNS=3
 */
import { PrismaClient } from '@prisma/client';
import { CouponStrategies, STRATEGIES, type Strategy } from '../src/coupons/lib/coupon-strategies';

const USERS = Number(process.env.USERS ?? 500);
const QUANTITY = Number(process.env.QTY ?? 100);
const RUNS = Number(process.env.RUNS ?? 3);
const MODE = process.env.MODE ?? 'inproc';
const API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const prisma = new PrismaClient();
const strategies = new CouponStrategies(prisma);

async function http(strategy: Strategy) {
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path} ${response.status}`);
    return (await response.json()) as { success: boolean; result: string; retries: number };
  };
  await post('/coupons/reset', { quantity: QUANTITY });
  const t0 = performance.now();
  const issueResponses = await Promise.all(
    Array.from({ length: USERS }, (_, i) => post('/coupons/issue', { strategy, userId: `u-${i}` })),
  );
  const durationMs = Math.round(performance.now() - t0);
  const demoState = await strategies.state('demo');
  return {
    strategy,
    issued: demoState?.issued ?? 0,
    counter: demoState?.counter ?? 0,
    oversold: demoState?.oversold ?? 0,
    retries: issueResponses.reduce((sum, issueResponse) => sum + issueResponse.retries, 0),
    errors: issueResponses.filter(
      (issueResponse) =>
        issueResponse.result === 'error' || issueResponse.result === 'retry_exhausted',
    ).length,
    durationMs,
  };
}

async function main() {
  console.log(`MODE=${MODE} USERS=${USERS} QTY=${QUANTITY} RUNS=${RUNS}`);
  console.log('strategy\trun\tissued\tcounter\toversold\tretries\terrors\tms');
  for (const strategy of STRATEGIES) {
    for (let run = 1; run <= RUNS; run++) {
      const result =
        MODE === 'http'
          ? await http(strategy)
          : await strategies
              .simulate(strategy, USERS, QUANTITY, `bench-${strategy}`)
              .then((simulation) => ({
                issued: simulation.final.issueRows,
                counter: simulation.final.issuedCount,
                oversold: simulation.final.oversold,
                retries: simulation.summary.totalRetries,
                errors: simulation.summary.error + simulation.summary.retry_exhausted,
                durationMs: simulation.durationMs,
              }));
      console.log(
        [
          strategy,
          run,
          result.issued,
          result.counter,
          result.oversold,
          result.retries,
          result.errors,
          Math.round(result.durationMs),
        ].join('\t'),
      );
    }
  }
  await prisma.coupon.deleteMany({ where: { name: { startsWith: 'bench-' } } });
  await prisma.$disconnect();
}
void main();
