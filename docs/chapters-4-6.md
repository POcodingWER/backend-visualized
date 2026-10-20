# 4~6장: 포인트 통장 · 결제 버튼 두 번 · 맛집 대기표

세 장 모두 실제 로컬 API(NestJS) + MySQL 8.4 (+ 6장은 Redis 7.4)에서 돌린 결과만 씁니다.
측정: 2026-10-20, 맥북(M1 Pro) 한 대. 상대 비교라 실행마다 흔들립니다.

## 4장 포인트 통장

`/ledger` · 코드 `apps/api/src/points/points.service.ts` · `POST /points/simulate`, `GET /points/:mode/entries`

- 시작 잔액 5,000P, 적립 +100P × 150건 + 사용 −100P × 50건을 **동시에** → 정상이면 15,000P.
- **덮어쓰기**(read-modify-write): `SELECT balance` → `INSERT PointEntry` → `UPDATE balance = <읽은 값 + amount>`.
  동시에 읽은 요청끼리 서로의 결과를 덮어써서 lost update.
- **통장(원장)**: 한 트랜잭션에서 `SELECT balance … FOR UPDATE` → 0 미만이면 거절 → `INSERT PointEntry` →
  `UPDATE balance = balance + amount`. 대사: `balance` vs `SUM(PointEntry.amount)`.

| 측정 (200건 동시)         | 덮어쓰기         | 통장                  |
| ------------------------- | ---------------- | --------------------- |
| 잔액 칸 / 내역 합계       | 4,900P / 15,000P | 15,000P / 15,000P     |
| 사라진 포인트 (대사 차이) | **10,100P**      | **0P**                |
| 걸린 시간                 | 0.11초           | 0.26초 (행 잠금 대기) |
| 잔액보다 많이 쓰기        | —                | 15,100P 시도 → 거절   |

다른 실행: 덮어쓰기 9,900P 사라짐 (잔액 5,100P). 기록: `apps/web/public/data/ledger-recorded-run.json`.
트레이드오프: 지갑 한 행을 잠그므로 한 사람에게 요청이 몰리면 줄이 길어진다. 실무에선 잔액을 SUM으로만 계산하거나,
잔액 칸은 캐시로 두고 대사 잡으로 검증한다.

## 5장 결제 버튼 두 번

`/double-pay` · 코드 `apps/api/src/payments/payments.service.ts` · `POST /payments` (`Idempotency-Key` 헤더), `GET /payments?orderId=`

- 브라우저가 실제로: 버튼 3번(0.09초 간격) + 첫 요청이 0.6초 안에 답이 없으면 자동 재시도 1번 = 요청 4개.
  서버의 가짜 결제사 승인은 0.9초.
- 키가 있으면 `INSERT Payment(status='processing', idempotencyKey)`를 **먼저** 시도. `idempotencyKey`는 UNIQUE라
  동시에 와도 한 행만 성공(P2002) → 진 요청은 50ms마다 조회해 `paid`가 되면 같은 결제를 돌려준다
  (`Idempotent-Replayed: true`). 같은 키에 다른 주문·금액이면 422.
- "먼저 조회해 보고 없으면 저장"은 동시 요청에서 둘 다 "없음"을 보므로 쓰지 않는다.

| 측정 (2026-10-20)              | 결제된 횟수             |
| ------------------------------ | ----------------------- |
| 요청 4개, 키 없이              | 4번                     |
| 요청 4개, 같은 키              | 1번 (3번은 같은 영수증) |
| 버튼 잠금만(1번 누름) + 재시도 | 2번                     |

통합 테스트: 같은 키 5개 동시 → 행 1개, 응답 5개 모두 같은 결제 id (`payments/test/payments.service.spec.ts`).
한계: 첫 요청이 결제사 호출 중 죽으면 키가 `processing`으로 남는다 → 운영에선 오래된 processing을 결제사에 조회해 정리하는 잡.
데모 행은 30분 뒤 cron이 지운다.

## 6장 맛집 대기표

`/cache` · 코드 `apps/api/src/cache-demo/cache-demo.service.ts` · `GET/POST /cache-demo/menu`, `POST /cache-demo/visitors`, `POST /cache-demo/stampede`

- 진짜 Redis. cache-aside: `GET bv:menu:board` → miss면 `SELECT MenuBoard` → `SET … EX 5`.
- 수정: `UPDATE MenuBoard`, 무효화를 켜면 `DEL bv:menu:board`.
- 스탬피드: 키를 지운 직후 1000개 읽기를 동시에. 서버 3대는 API 한 프로세스 안에서 흉내(인스턴스별 single-flight 3개).
  Redis 잠금: `SET bv:menu:board:lock <uuid> NX PX 2000` → 잡은 한 명만 DB → `SET EX` → 내 토큰일 때만 DEL(Lua).
  나머지는 20ms마다 GET, 1초 넘으면 DB에서 직접(db-fallback).
- DB 읽기는 `findFirst`로 센다 — Prisma `findUnique`는 같은 틱의 호출을 한 쿼리로 묶어서 "1000번"이 실제로는 1번이 된다.
  MySQL `Com_select` 증가량으로 1000번 읽기 = SELECT 약 1,000개 확인.

| 측정 (1000명)                    | DB 읽기         | Redis 명령                             | 시간 |
| -------------------------------- | --------------- | -------------------------------------- | ---- |
| 매번 DB                          | 1000            | —                                      | 63ms |
| 대기판(캐시) 먼저                | 1 (차 있으면 0) | GET 1000                               | 23ms |
| 스탬피드, 대책 없음              | 1000            | GET 1000, SET EX 1000                  | 96ms |
| 스탬피드, 서버마다 single-flight | 3               | GET 1000, SET EX 3                     | 10ms |
| 스탬피드, Redis 잠금             | 1               | GET 1999, SET NX 1000, SET EX 1, DEL 1 | 45ms |

- 수정 후 새 메뉴가 보이기까지 (0.5초 간격으로 7초간 확인): 무효화 없이 **5.2초**(남은 TTL), `DEL` 하면 **0초**(첫 확인부터 새 메뉴).
- 한 인스턴스 전제: single-flight는 프로세스 메모리 안에서만 묶는다 → 여러 대면 Redis 잠금이 필요하다는 게 이 장의 요점.
  (API의 single-flight는 웹 `lib/single-flight.ts`와 같은 코드 — API는 CommonJS, 웹 SDK 패키지는 ESM이라 복사본.)
- 로컬: `docker compose up -d redis` → `bv-redis`, `localhost:6380`(다른 Redis와 안 겹치게), 디스크 저장 끔.
  운영: `docker-compose.prod.yml`의 `redis` 컨테이너(`maxmemory 64mb`, `allkeys-lru`), `REDIS_URL` 필수. 자세한 건 [deploy.md](deploy.md).
