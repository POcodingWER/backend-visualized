# Stage 3 — 선착순 쿠폰: 동시성 제어 전략 비교

쿠폰 **100장**에 **500명**이 동시에 몰릴 때, 발급 로직 4가지가 어떻게 동작하는지 측정했습니다.

| 전략          | 구현                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `none`        | `SELECT` → 남았으면 `INSERT CouponIssue` → `UPDATE issuedCount = (읽은 값 + 1)`                                 |
| `pessimistic` | 트랜잭션 안에서 `SELECT ... FOR UPDATE` 로 행 락 → 확인 → `INSERT` → `issuedCount + 1`                          |
| `optimistic`  | `SELECT (issuedCount, version)` → `UPDATE ... WHERE version = ?` 0행이면 백오프 후 재시도 (최대 30회)           |
| `atomic`      | `UPDATE Coupon SET issuedCount = issuedCount + 1 WHERE id = ? AND issuedCount < totalQuantity` 1행이면 `INSERT` |

코드: [`apps/api/src/coupons/coupon-strategies.ts`](../../apps/api/src/coupons/coupon-strategies.ts)

## 환경

| 항목      | 값                                                                          |
| --------- | --------------------------------------------------------------------------- |
| 머신      | Apple M1 Pro, 16GB RAM (macOS, 로컬 1대에서 클라이언트·API·DB 모두 실행)    |
| DB        | MySQL 8.4 (Docker `bv-mysql`, host 3307, 기본 설정, InnoDB REPEATABLE READ) |
| API / ORM | NestJS 11 + Prisma 6.19 (커넥션 풀 기본값), Node 20.18                      |
| 조건      | 사용자 500명이 동시에 1번씩 요청, 쿠폰 100장                                |
| 날짜      | 2026-10-19                                                                  |

## 재현 방법

```bash
pnpm --filter @bv/api prisma:deploy
pnpm --filter @bv/api bench:coupon                 # in-process: Prisma로 동시 Promise 500개 (RUNS=3)
# HTTP: 별도 포트에 rate limit을 크게 해서 API를 띄우고
cd apps/api && PORT=4100 THROTTLE_LIMIT=1000000 node --env-file=.env dist/main.js
MODE=http API_URL=http://localhost:4100 RUNS=2 pnpm --filter @bv/api bench:coupon
# k6가 있다면 (이번 측정에는 사용하지 않음, k6 미설치)
k6 run -e STRATEGY=atomic -e API_URL=http://localhost:4100 load/coupon.js
```

## 결과 A — in-process (동시 Promise 500개, 3회)

| 전략        | 실제 발급(행) | 카운터 | 초과 발급 | 재시도 합계 | 실패(재시도 초과) | 시간 (1/2/3회)       |
| ----------- | ------------: | -----: | --------: | ----------: | ----------------: | -------------------- |
| none        |           500 |      1 |   **400** |           0 |                 0 | 2.48 / 2.35 / 2.34 s |
| pessimistic |           100 |    100 |         0 |           0 |                 0 | 1.68 / 1.70 / 1.73 s |
| optimistic  |        **60** |     60 |         0 |     ~14,140 |           **440** | 23.4 / 24.0 / 23.3 s |
| atomic      |           100 |    100 |         0 |           0 |                 0 | 0.46 / 0.39 / 0.41 s |

## 결과 B — HTTP (`POST /coupons/issue` 동시 500개, 2회)

| 전략        | 실제 발급(행) | 카운터 | 초과 발급 | 재시도 합계 | 실패(재시도 초과) | 시간 (1/2회)  |
| ----------- | ------------: | -----: | --------: | ----------: | ----------------: | ------------- |
| none        |           500 |    2/1 |   **400** |           0 |                 0 | 2.76 / 2.49 s |
| pessimistic |           100 |    100 |         0 |           0 |                 0 | 1.81 / 1.77 s |
| optimistic  |        **60** |     60 |         0 |     ~14,140 |           **440** | 23.6 / 24.0 s |
| atomic      |           100 |    100 |         0 |           0 |                 0 | 0.61 / 0.55 s |

## 해석

- **none**: 500명 전원이 "아직 0장 발급됨"을 읽고 통과 → 100장짜리 쿠폰이 **500장(400장 초과)** 발급.
  카운터는 모두 `읽은 값 + 1 = 1`을 덮어써서 **1~2** (lost update). 실제 발급 행 수와 카운터가 어긋남.
- **pessimistic**: 정확히 100장. 모든 요청이 한 행의 락 앞에 줄을 서서 직렬화되므로 안전하지만,
  트랜잭션이 커넥션을 쥔 채 대기하므로 대기열이 길수록 커넥션 풀이 고갈될 수 있음.
- **optimistic**: 초과 발급은 0이지만, 하나의 행에 500명이 몰리는 **고경합** 상황에선 대부분 version 충돌 →
  재시도 약 14,000회, 30회 재시도 한도를 넘긴 440명이 실패해 **100장 중 60장만 발급**되고 24초 소요.
  충돌이 드문(저경합) 데이터에 적합한 방식이라는 것을 보여줌.
- **atomic**: 확인과 증가를 조건부 `UPDATE` 한 문장으로 DB가 원자적으로 처리 → 정확히 100장, 가장 빠름(약 0.4~0.6s).
  선착순 재고 차감처럼 "남은 수량 감소"가 핵심인 경우 가장 단순하고 효과적.
- 테스트: [`coupon-strategies.spec.ts`](../../apps/api/src/coupons/test/coupon-strategies.spec.ts) — 300명 vs 50장에서
  `none`은 초과 발급, 나머지 3개는 정확히 50장임을 실제 MySQL로 검증.

## API 응답 형태 (관찰용)

`POST /coupons/simulate { strategy?, users ≤ 1000, quantity ≤ 500 }` → `{ results: SimulationResult[] }`

```jsonc
{
  "strategy": "none", "couponName": "sim-none", "couponId": 3, "users": 500, "quantity": 100, "durationMs": 2512.4,
  "final": { "issueRows": 500, "issuedCount": 1, "version": 0, "oversold": 400, "counterMismatch": true },
  "summary": { "issued": 500, "sold_out": 0, "retry_exhausted": 0, "error": 0, "totalRetries": 0 },
  // 시뮬레이션 중 별도 DB 커넥션(connection_limit=1)으로 ~25ms마다 읽은 실제 상태
  "dbSnapshots": [{ "atMs": 0, "issuedCount": 0, "version": 0, "issueRows": 0 }, …],
  // 요청별 기록 (완료 순)
  "requests": [{
    "requestId": 17, "userId": "user-17", "startedAtMs": 0.9, "finishedAtMs": 570.9, "durationMs": 570.0,
    "success": true, "result": "issued",            // issued | sold_out | retry_exhausted | error
    "retries": 0, "oversold": false, "issueSeq": 1, "issueRowId": "1234",
    "readIssuedCount": 0,                            // none: 읽은 카운터 값
    // pessimistic: poolWaitMs, lockWaitMs  /  atomic: affectedRows (0이면 품절 거절)
  }, …]
}
```

`GET /coupons/:name/state?limit=20&offset=0` → 실제 DB의 Coupon 행, `COUNT(CouponIssue)`, 최근 발급 행(초과 발급 표시 포함).
