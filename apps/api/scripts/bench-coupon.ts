/**
 * Stage 3 coupon benchmark: 500명 vs 쿠폰 100장, 전략별 초과 발급/시간/재시도
 *
 *   pnpm --filter @bv/api bench:coupon                 # MODE=inproc (서버 프로세스 없이 Prisma 직접, 동시 Promise)
 *   MODE=http API_URL=http://localhost:4100 pnpm --filter @bv/api bench:coupon
 *     → 동시 HTTP 요청 USERS개를 POST /coupons/issue 로. rate limit을 피하려면 API를 THROTTLE_LIMIT=1000000 으로 실행
 *   USERS=500 QTY=100 RUNS=3
 */
import { PrismaClient } from '@prisma/client';
import { CouponStrategies, STRATEGIES, type Strategy } from '../src/coupons/coupon-strategies';

const USERS = Number(process.env.USERS ?? 500);
const QTY = Number(process.env.QTY ?? 100);
const RUNS = Number(process.env.RUNS ?? 3);
const MODE = process.env.MODE ?? 'inproc';
const API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const prisma = new PrismaClient();
const s = new CouponStrategies(prisma);

async function http(strategy: Strategy) {
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return (await r.json()) as { ok: boolean; reason: string; retries: number };
  };
  await post('/coupons/reset', { quantity: QTY });
  const t0 = performance.now();
  const res = await Promise.all(
    Array.from({ length: USERS }, (_, i) => post('/coupons/issue', { strategy, userId: `u-${i}` })),
  );
  const durationMs = Math.round(performance.now() - t0);
  const st = await s.state('demo');
  return {
    strategy,
    issued: st?.issued ?? 0,
    counter: st?.counter ?? 0,
    oversold: st?.oversold ?? 0,
    retries: res.reduce((a, r) => a + r.retries, 0),
    errors: res.filter((r) => r.reason === 'error' || r.reason === 'conflict').length,
    durationMs,
  };
}

async function main() {
  console.log(`MODE=${MODE} USERS=${USERS} QTY=${QTY} RUNS=${RUNS}`);
  console.log('strategy\trun\tissued\tcounter\toversold\tretries\terrors\tms');
  for (const st of STRATEGIES) {
    for (let run = 1; run <= RUNS; run++) {
      const r =
        MODE === 'http'
          ? await http(st)
          : await s.simulate(st, USERS, QTY, `bench-${st}`).then((x) => ({
              ...x,
              errors: x.errors + x.conflicts,
            }));
      console.log(
        [
          st,
          run,
          r.issued,
          r.counter,
          r.oversold,
          r.retries,
          r.errors,
          Math.round(r.durationMs),
        ].join('\t'),
      );
    }
  }
  await prisma.coupon.deleteMany({ where: { name: { startsWith: 'bench-' } } });
  await prisma.$disconnect();
}
void main();
