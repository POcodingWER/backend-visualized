# Stage 2 — 이벤트 수집: 단건 insert vs 배치 insert

10,000개 이벤트를 넣는 데 걸리는 시간을 **DB 레벨(Prisma `create` vs `createMany`)** 과
**HTTP 레벨(`POST /events` vs `POST /events/batch`)** 에서 비교했습니다.

## 환경

| 항목       | 값                                                                          |
| ---------- | --------------------------------------------------------------------------- |
| 머신       | Apple M1 Pro, 16GB RAM (macOS, 로컬 1대에서 클라이언트·API·DB 모두 실행)    |
| DB         | MySQL 8.4.11 (Docker `bv-mysql`, host 3307, 기본 설정)                      |
| API        | NestJS 11 + Prisma 6.19, `node dist/main.js` (빌드 결과물, 단일 프로세스)   |
| 클라이언트 | Node 20.18 `fetch`, 같은 머신                                               |
| 데이터     | 이벤트 1개 = `{ name, sessionId(500종), properties: { i } }`, 배치 크기 100 |
| 날짜       | 2026-10-19                                                                  |

## 재현 방법

```bash
docker compose up -d && pnpm install && pnpm --filter @bv/api prisma:deploy && pnpm build
# rate limit(기본 IP당 200req/10s)에 걸리지 않도록 limit을 크게 해서 API 실행
cd apps/api && THROTTLE_LIMIT=1000000 node --env-file=.env dist/main.js
# 다른 터미널
pnpm --filter @bv/api bench          # N=10000 BATCH=100 CONCURRENCY=10 로 조절 가능
```

스크립트: [`apps/api/scripts/bench-ingest.ts`](../../apps/api/scripts/bench-ingest.ts) —
각 시나리오 후 행 수가 정확히 10,000인지 검증하고, 끝나면 `bench_*` 데이터를 삭제합니다.

## 결과 (10,000 이벤트, 2회 실행)

| 시나리오                                        | 요청 수 |  1회차 |  2회차 | events/s (1회/2회) |
| ----------------------------------------------- | ------: | -----: | -----: | -----------------: |
| DB `create()` × 10,000 (순차)                   |  10,000 | 70.4 s | 75.0 s |          142 / 133 |
| DB `create()` × 10,000 (동시 10)                |  10,000 | 20.6 s | 15.2 s |          485 / 658 |
| DB `createMany()` 100개 × 100 (순차)            |     100 | 1.21 s | 1.04 s |      8,270 / 9,605 |
| HTTP `POST /events` × 10,000 (동시 10)          |  10,000 | 18.7 s | 16.1 s |          535 / 622 |
| HTTP `POST /events/batch` 100개 × 100 (순차)    |     100 | 1.51 s | 1.00 s |      6,611 / 9,967 |
| HTTP `POST /events/batch` 100개 × 100 (동시 10) |     100 | 0.29 s | 0.25 s |    34,625 / 40,762 |

## 해석

- **DB 레벨**: 순차 기준 `createMany`(100개씩)가 `create`보다 약 **58~72배** 빠름.
  단건 insert는 행마다 네트워크 왕복 + 트랜잭션 커밋(InnoDB redo log flush)이 발생하는데,
  `createMany`는 `INSERT ... VALUES (...), (...)` 한 문장·한 커밋으로 100행을 처리하기 때문.
- **HTTP 레벨**: 같은 동시성 10에서 배치 엔드포인트가 단건보다 약 **65배**(18.7s → 0.29s) 빠름.
  HTTP 요청 수 자체가 1/100로 줄어 파싱·검증·커넥션 오버헤드도 함께 줄어듦.
- 단건 HTTP(동시 10)가 DB 단건 순차보다 빠른 것은 동시성 덕분이며, DB 단건 동시 10과 비슷한 수준 →
  단건 경로의 병목은 HTTP보다 **DB 커밋 횟수** 쪽.
- 결론: SDK가 이벤트를 큐에 모아 `/events/batch`로 보내는 설계(Stage 2)가 수집 처리량을 크게 높임.

## 한계 / 주의

- 한 대의 노트북에서 클라이언트·API·DB를 함께 돌린 결과라 절대값보다는 **상대 비교**로 봐야 함. 실행마다 ±30% 정도 흔들림.
- MySQL 기본 설정(`innodb_flush_log_at_trx_commit=1`)이라 단건 커밋 비용이 큼. 설정·디스크에 따라 격차는 달라짐.
- 배치 크기(100)·동시성(10)만 측정. 배치 크기별 곡선은 Stage 3에서 k6로 측정 예정.
- 배치는 한 문장이라 부분 실패 시 100개 전체가 실패함(현재 SDK는 5xx/네트워크 오류 시 배치 단위로 재시도).
