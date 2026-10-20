/**
 * 3장 묶음배송(이벤트 수집) 벤치마크 (docs/benchmarks/delivery-batching.md): 단건 vs 배치 insert
 *
 *   pnpm --filter @bv/api bench               # API가 http://localhost:4000 에 떠 있어야 함
 *   N=10000 BATCH=100 CONCURRENCY=10 API_URL=... pnpm --filter @bv/api bench
 *
 * 주의: 단건 10,000 요청은 rate limit에 걸리므로 API를 THROTTLE_LIMIT=1000000 으로 띄우고 실행.
 * 벤치 데이터는 name='bench_*' 로 넣고 끝나면 삭제합니다.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const TOTAL_EVENTS = Number(process.env.N ?? 10_000);
const BATCH = Number(process.env.BATCH ?? 100);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const prisma = new PrismaClient();
const makeEvent = (name: string, i: number) => ({
  name,
  sessionId: `bench-${i % 500}`,
  properties: { i },
});

interface Result {
  scenario: string;
  requests: number;
  ms: number;
}

async function pool(total: number, conc: number, job: (i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(conc, total) }, async () => {
      while (next < total) await job(next++);
    }),
  );
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${await res.text()}`);
  await res.arrayBuffer();
}

async function timed(scenario: string, requests: number, fn: () => Promise<void>): Promise<Result> {
  const t0 = performance.now();
  await fn();
  const ms = performance.now() - t0;
  const result = { scenario, requests, ms };
  console.log(
    `${scenario.padEnd(42)} ${ms.toFixed(0).padStart(7)} ms  ${((TOTAL_EVENTS / ms) * 1000).toFixed(0).padStart(7)} events/s  ${((requests / ms) * 1000).toFixed(0).padStart(6)} req/s`,
  );
  return result;
}

async function main() {
  console.log(`N=${TOTAL_EVENTS} BATCH=${BATCH} CONCURRENCY=${CONCURRENCY} API=${API}\n`);
  await prisma.event.deleteMany({ where: { name: { startsWith: 'bench_' } } });
  const batchCount = Math.ceil(TOTAL_EVENTS / BATCH);
  const results: Result[] = [];

  // --- DB 레벨 (Prisma 직접) ---
  results.push(
    await timed('DB  create() x N (순차)', TOTAL_EVENTS, async () => {
      for (let i = 0; i < TOTAL_EVENTS; i++)
        await prisma.event.create({ data: makeEvent('bench_db_single', i) });
    }),
  );
  results.push(
    await timed(`DB  create() x N (동시 ${CONCURRENCY})`, TOTAL_EVENTS, () =>
      pool(TOTAL_EVENTS, CONCURRENCY, async (i) => {
        await prisma.event.create({ data: makeEvent('bench_db_single_c', i) });
      }),
    ),
  );
  results.push(
    await timed(`DB  createMany() ${BATCH}개씩 x ${batchCount} (순차)`, batchCount, async () => {
      for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        const data: Prisma.EventCreateManyInput[] = [];
        for (let i = batchIndex * BATCH; i < Math.min(TOTAL_EVENTS, (batchIndex + 1) * BATCH); i++)
          data.push(makeEvent('bench_db_batch', i));
        await prisma.event.createMany({ data });
      }
    }),
  );

  // --- HTTP 레벨 ---
  results.push(
    await timed(`HTTP POST /events x N (동시 ${CONCURRENCY})`, TOTAL_EVENTS, () =>
      pool(TOTAL_EVENTS, CONCURRENCY, (i) => post('/events', makeEvent('bench_http_single', i))),
    ),
  );
  results.push(
    await timed(`HTTP POST /events/batch ${BATCH}개씩 (순차)`, batchCount, async () => {
      for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        const events = Array.from(
          { length: Math.min(BATCH, TOTAL_EVENTS - batchIndex * BATCH) },
          (_, k) => makeEvent('bench_http_batch', batchIndex * BATCH + k),
        );
        await post('/events/batch', { events });
      }
    }),
  );
  results.push(
    await timed(`HTTP POST /events/batch ${BATCH}개씩 (동시 ${CONCURRENCY})`, batchCount, () =>
      pool(batchCount, CONCURRENCY, (batchIndex) =>
        post('/events/batch', {
          events: Array.from(
            { length: Math.min(BATCH, TOTAL_EVENTS - batchIndex * BATCH) },
            (_, k) => makeEvent('bench_http_batch_c', batchIndex * BATCH + k),
          ),
        }),
      ),
    ),
  );

  const counts = await prisma.event.groupBy({
    by: ['name'],
    where: { name: { startsWith: 'bench_' } },
    _count: { _all: true },
  });
  console.log(
    '\n검증(행 수):',
    counts.map((countRow) => `${countRow.name}=${countRow._count._all}`).join(', '),
  );
  const del = await prisma.event.deleteMany({ where: { name: { startsWith: 'bench_' } } });
  console.log(`정리: bench_* ${del.count}행 삭제`);
  console.log(
    '\nJSON',
    JSON.stringify(results.map((result) => ({ ...result, ms: Math.round(result.ms) }))),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
