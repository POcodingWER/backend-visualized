# 인수인계 문서 — 처음 이 저장소를 맡는 사람에게

"버튼 하나 뒤에서"는 백엔드 문제 여섯 가지를 브라우저 버튼 하나로 **실제 서버·DB에서 일으키고, 고친 결과를 숫자로 보여주는** 그림책 사이트입니다.

- 웹: `apps/web` (Next.js 15 App Router)
- API: `apps/api` (NestJS + Prisma + MySQL, 6장만 Redis)
- SDK: `packages/sdk` (3장에서 쓰는 클릭 기록 트래커)

API 폴더 규칙과 Nest 개념 설명은 [architecture.md](architecture.md)를, 배포는 [deploy.md](deploy.md)를 보세요.

## 1. 로컬에서 띄우기

필요한 것: Node 20 이상, pnpm 9(`corepack enable`), Docker(Redis용), MySQL 8.

```bash
pnpm install

# 환경 변수 파일 복사
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

**MySQL (3306)** — 로컬에 설치된 MySQL을 씁니다. `backend_visualized` 데이터베이스를 만들고 `apps/api/.env`의 `DATABASE_URL`에 내 계정을 적습니다.

```bash
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS backend_visualized"
# apps/api/.env
# DATABASE_URL="mysql://root:<비밀번호>@localhost:3306/backend_visualized"
```

MySQL을 설치하기 싫으면 `docker compose up -d mysql`(bv-mysql, **3307** 포트, 비밀번호 `root_password`)도 됩니다. 이때는 URL의 포트를 3307로 바꿉니다.

**Redis (6380)** — 6장 전용 Redis 컨테이너입니다. 다른 Redis(6379)와 겹치지 않게 6380으로 엽니다.

```bash
docker compose up -d redis      # bv-redis, localhost:6380
```

**DB 테이블 만들기 → 실행**

```bash
pnpm --filter @bv/api prisma:deploy   # 마이그레이션 적용 (개발 중 스키마를 바꿀 땐 prisma:migrate)
pnpm dev                              # web http://localhost:3000 · api http://localhost:4000
curl localhost:4000/health            # {"status":"ok"...} 이면 DB 연결 OK
```

`pnpm dev`는 turbo로 web(`next dev`)과 api(`tsc-watch` → `node dist/main.js`)를 같이 띄웁니다. 데모 계정은 `demo` / `demo1234` (API가 시작할 때 자동으로 만듭니다).

### 환경 변수

| 파일                  | 변수                            | 뜻                                                                                       |
| --------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/api/.env`       | `DATABASE_URL`                  | MySQL 주소. **필수**                                                                     |
|                       | `REDIS_URL`                     | 생략하면 `redis://127.0.0.1:6380/0` (bv-redis)                                           |
|                       | `WEB_ORIGIN`                    | CORS 허용 주소 (`http://localhost:3000`)                                                 |
|                       | `JWT_ACCESS_SECRET`, `AUTH_*`   | 2장 토큰 설정. 개발용 기본값이 있어 비워도 된다                                          |
|                       | `ADMIN_API_KEY`                 | `/events/admin/*` 키. 개발에선 비우면 키 없이 허용                                       |
|                       | `COUPON_SIMULATION_COOLDOWN_MS` | 1·4·6장 시뮬레이션 공용 쿨다운 (이름은 1장 시절 그대로, 코드에선 `simulationCooldownMs`) |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL`           | API 주소. 기본 `http://localhost:4000`                                                   |

운영 환경 변수 전체 표: [deploy.md 5장](deploy.md). 운영 모드(`NODE_ENV=production`)에서는 위험한 기본값이면 API가 아예 시작하지 않습니다 (`common/config/environment.ts`).

### 자주 쓰는 명령 (레포 루트)

| 명령                | 하는 일                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `pnpm dev`          | web + api 개발 서버                                                                  |
| `pnpm format:check` | Prettier 검사 (`pnpm format`으로 고침)                                               |
| `pnpm typecheck`    | 전체 타입 검사                                                                       |
| `pnpm lint`         | ESLint                                                                               |
| `pnpm test`         | api·web·sdk 테스트                                                                   |
| `pnpm build`        | 전체 빌드 (개발 서버를 끄고 실행, 끝나면 `rm -rf apps/web/.next` 후 다시 `pnpm dev`) |

## 2. 무엇이 어디에 있나

```
apps/web/
  app/
    page.tsx                  첫 화면 (장 목록, 만든 사람)
    layout.tsx                공통 머리말(SiteHeader)·글꼴·손그림 필터
    <장>/page.tsx             장 하나: 4컷 만화 + 데모 컴포넌트 (ticketing, wristband, delivery, ledger, double-pay, cache)
    <장>/api.ts               그 장이 부르는 API 함수 + 응답 타입 (화면 컴포넌트는 fetch를 직접 쓰지 않는다)
    <장>/*Demo.tsx, ...       그 장에서만 쓰는 컴포넌트·CSS는 장 폴더 안에
    components/
      atoms/                  Button, Conclusion(결론 한 줄), ink(만화 먹색·선)
      molecules/              DevDetails(개발자용 자세히), ResultNumbers(실측 숫자 묶음)
      organisms/              ChapterLayout(장 뼈대), ComicStrip(4컷 만화), SiteHeader
      ui.module.css           공용 스타일 (버튼·결론·제목·표)
      flow.module.css         요청이 지나가는 길(점·화살표) 그림 스타일
  lib/
    api.ts                    API_URL, callApi(공통 fetch), requireOk, FriendlyError
    site.ts                   장 목록(CHAPTERS), GitHub 주소
    useReplay.ts              실측 타임라인을 2.5~6초로 다시 재생하는 훅
    single-flight.ts          진행 중인 Promise 공유 (2장 토큰 갱신)
  public/data/*.json          "지난 실측 기록" — 첫 화면을 빈 상태 없이 보여주는 값

apps/api/src/                 폴더 = URL 첫 단어 = 모듈 (자세히: architecture.md)
  coupons/ auth/ events/ points/ payments/ cache-demo/ health/
  prisma/ redis/              DB·Redis 연결 하나씩
  common/                     여러 모듈이 같이 쓰는 가드·한도·설정·유틸
apps/api/prisma/              schema.prisma(테이블 정의, 유일한 출처) + migrations/
apps/api/scripts/             벤치마크 (pnpm --filter @bv/api bench, bench:coupon)
packages/sdk/                 @bv/sdk: track() → 큐 → POST /events/batch, sendBeacon, 오프라인 재전송
load/coupon.js                k6 부하 테스트 (선택, 1장)
deploy/                       운영 compose 스크립트, Caddyfile, production.env.example
docs/                         이 문서, architecture, deploy, auth-tokens, chapters-4-6, benchmarks/
.cursor/rules/                AI 어시스턴트 규칙 (ponytail.mdc: 가장 단순하게, architecture.mdc: 폴더 규칙)
```

## 3. 장별 흐름 (버튼 → API → DB → 화면)

공통으로 모든 요청은 이렇게 지나갑니다: **화면 컴포넌트 → `app/<장>/api.ts` → `lib/api.ts`의 `callApi` → API의 가드(IP별 한도 `ThrottlerGuard`) → `ValidationPipe` + DTO(모양이 틀리면 400) → 컨트롤러(HTTP만) → 서비스(로직) → Prisma/Redis → JSON → 화면.**
시뮬레이션 버튼(1·4·6장)은 컨트롤러가 `UsageLimitsService.runSimulation`으로 감쌉니다: 서버 전체에서 한 번에 하나(아니면 409), 끝난 뒤 쿨다운(429 `simulation_cooldown`).

### 1장 티켓팅 `/ticketing` — 선착순 쿠폰 100장에 500명

- 화면: `TicketingDemo.tsx`(큰 버튼, 결과 재생) · `StrategyLab.tsx`(전략별 실험실) · `DbPanels.tsx`
- `ticketing/api.ts` `runSimulation` → `POST /coupons/simulate` (`SimulateDto`: users, quantity, strategy?)
- `CouponsController.simulate` → `CouponsService.simulate` → `coupons/lib/coupon-strategies.ts`의 `CouponStrategies.simulate`
  - 쿠폰 행을 리셋하고 가상 사용자 N명이 동시에 `issue(strategy)`: `none`(읽고 쓰기, 초과 발급), `pessimistic`(`SELECT … FOR UPDATE`), `optimistic`(version 비교 + 재시도), `atomic`(`UPDATE … WHERE issuedCount < totalQuantity` 한 줄)
  - 테이블: `Coupon`, `CouponIssue` (쿠폰 이름 `sim-<전략>`)
- 응답 `results[]`(요청마다 시작·끝 시각 timeline) → `useReplay`로 다시 재생, `GET /coupons/:name/state`로 DB 패널
- 벤치마크: [benchmarks/stage3-coupon.md](benchmarks/stage3-coupon.md)

### 2장 손목밴드 `/wristband` — 로그인이 유지되는 원리

- 화면: `AuthDemo.tsx`(로그인·요청 기록) · `WristbandStory.tsx` · `TheftDemo.tsx` · `ConcurrencyRace.tsx` · `JwtDecoder.tsx`
- `wristband/api.ts`의 `authApi.*` (모든 요청 `credentials: 'include'` — 리프레시 토큰이 httpOnly 쿠키라서)
  - `POST /auth/login` → `AuthService.login`: 비밀번호 확인(`auth/lib/password.ts`, scrypt) → 액세스 토큰(JWT, 짧음) + 리프레시 토큰(쿠키, `RefreshTokenStore.issueNewFamily`)
  - `GET /auth/me` → `AccessTokenGuard`(Bearer JWT 검증)
  - `POST /auth/refresh` → `AuthService.refresh` → `RefreshTokenStore.rotate`: 쓴 토큰은 `used`, 새 토큰 발급. **이미 쓴 토큰이 또 오면 재사용 감지 → 패밀리 전체 폐기**
  - `POST /auth/logout`, `GET /auth/families/:id`, 데모 전용 `POST /auth/demo/steal-refresh-token`, `/auth/demo/expired-access-token`(`AUTH_DEMO_ENDPOINTS=true`일 때만)
- 테이블: `User`, `RefreshToken` (원문 대신 SHA-256 해시 저장)
- 동시에 401을 받은 요청 여러 개가 갱신을 한 번만 하도록 웹은 `lib/single-flight.ts` 사용
- 설계 문서: [auth-tokens.md](auth-tokens.md)

### 3장 묶음배송 `/delivery` — 클릭 기록이 저장되기까지

- 화면: `DeliveryDemo.tsx` · `Pipeline.tsx`(SDK 큐 → API → DB → 집계표 그림) · `DailyChart.tsx`
- 클릭 기록: `@bv/sdk`의 `createTracker` → 큐에 모았다가 `POST /events/batch` (`BatchEventsDto`, 1~100개) → `EventsService.createBatch` → Prisma `createMany` → `Event` 테이블 → `EventBus` 알림 → `GET /events/stream`(SSE)으로 화면의 DB 카운터가 오름
- `delivery/api.ts`
  - `sendEventsBothWays`: 같은 N개를 `POST /events` 단건 vs `/events/batch` 묶음으로 보내 요청 수·시간 비교
  - `probeRateLimit`: `POST /events/demo/rate-limit-probe` 210번 → IP별 한도 429 체험 (DB에 안 씀)
  - `runDemoAggregate`: `POST /events/demo/aggregate` → `events/lib/aggregation.service.ts` (`INSERT … SELECT … ON DUPLICATE KEY UPDATE`로 KST 날짜별 `EventDailyStat` 갱신, 5분 cron도 같은 함수)
  - `loadStoredTotal`/`loadDailyStats`: `GET /events/stats`, `/events/stats/daily`
- 날짜 계산(KST)은 순수 함수 `events/lib/date-range.ts`
- 벤치마크: [benchmarks/stage2-ingest.md](benchmarks/stage2-ingest.md)

### 4장 포인트 통장 `/ledger` — 잔액이 저절로 틀어지는 이유

- 화면: `LedgerDemo.tsx`
- `ledger/api.ts` `simulatePoints` → `POST /points/simulate` (`SimulatePointsDto`) → `PointsService.simulateBothModes`
  - 덮어쓰기(`applyByOverwrite`): 잔액을 읽고 계산해 덮어씀 → 동시 요청이 서로의 몫을 지움
  - 통장(`applyByLedger`): 한 트랜잭션 안에서 지갑 행을 잠그고(`FOR UPDATE`) → 0 미만이면 거절 → `PointEntry` 한 줄 추가 → 잔액 += 금액
  - `reconcile`: 잔액 vs 내역 합계 차이
- `loadWalletEntries` → `GET /points/:mode/entries` (`EntriesParamsDto`) → `PointsService.entriesFor`
- 테이블: `PointWallet`, `PointEntry` (지갑 이름 `sim-overwrite`, `sim-ledger`)

### 5장 결제 버튼 두 번 `/double-pay` — 두 번 눌러도 한 번만 결제

- 화면: `PaymentDemo.tsx` (연타 + 앱 자동 재시도 시나리오를 키 없이/키 있게 두 번)
- `double-pay/api.ts` `pay` → `POST /payments` (`PayDto` + `Idempotency-Key` 헤더) → `PaymentsService.pay`
  - 키가 없으면 누를 때마다 새 결제. 키가 있으면 `(idempotencyKey)` 유니크 행을 먼저 `processing`으로 INSERT → 가짜 PG 대기 → `paid`. 같은 키가 또 오면 처음 결과를 다시 돌려줌(`replayed`, `Idempotent-Replayed` 헤더), 처리 중이면 409, 같은 키로 다른 주문·금액이면 422. 동시에 같은 키가 와도 `idempotencyKey` **unique 제약**이 INSERT를 하나만 통과시킵니다
- `listPayments` → `GET /payments?orderId=` 로 실제 생긴 행을 0.2초마다 확인
- 테이블: `Payment` (오래된 데모 행은 서비스가 정리)

### 6장 맛집 대기표 `/cache` — 빠르게 보여주고, 제때 바꾸기

- 화면: `CacheDemo.tsx` (손님 1000명, 메뉴 바꾸기, 몰림(stampede) 세 구역)
- `cache/api.ts`
  - `runVisitors` → `POST /cache-demo/visitors` → `CacheDemoService.welcomeVisitors`: DB 직접 vs 캐시 경유 DB 읽기 횟수
  - `readMenu`/`editMenu` → `GET/POST /cache-demo/menu`: `readThroughCache`(Redis `GET` → 없으면 MySQL `MenuBoard` → `SET EX 5초`), `edit(invalidate)`(DB 수정 후 `DEL` 할지 말지)
  - `runStampede` → `POST /cache-demo/stampede` → `compareStampedes`: 대책 없음 / 서버마다 single-flight(`common/utils/single-flight.ts`) / Redis 잠금(`SET NX PX` + Lua로 안전 해제)
- 연결: `redis/redis.service.ts`(ioredis, `REDIS_URL`). 키는 `bv:menu:*`, TTL 5초라 저절로 사라짐
- 설명 문서: [chapters-4-6.md](chapters-4-6.md)

## 4. 새 장(chapter) 추가하기 — 7장 "예약 대기열"을 예로

1. **DB**: `apps/api/prisma/schema.prisma`에 모델 추가 → `pnpm --filter @bv/api prisma:migrate --name reservations` (마이그레이션 파일이 생김, 커밋). `entities/` 폴더는 만들지 않고 Prisma 타입을 그대로 씁니다.
2. **API 모듈**: `apps/api/src/reservations/` (URL 첫 단어 = 폴더)
   - `reservations.module.ts`, `reservations.controller.ts`(라우트·DTO·한도·상태 코드만), `reservations.service.ts`(로직·Prisma)
   - `dto/reservations.dto.ts` — 다른 DTO 파일처럼 첫 줄에 `// DTO = 요청 본문/쿼리의 모양 + 검증 규칙 …` 주석, class-validator 데코레이터
   - 이 모듈만 쓰는 순수 계산·알고리즘은 `lib/`에 (필요할 때만)
   - `app.module.ts`의 `imports`에 `ReservationsModule` 추가
   - 공개 데모 버튼이면 `@UseGuards(ThrottlerGuard)` + `@Throttle`, 무거운 시뮬레이션이면 `usageLimits.runSimulation(gate, …)` (`common/rate-limit`)
3. **API 테스트**: `src/reservations/test/reservations.service.spec.ts` (`node:test`). DB를 쓰면 만든 행을 `after`에서 지우기.
4. **웹 페이지**: `apps/web/app/reservations/`
   - `page.tsx`: `ChapterLayout` + `ComicStrip`(4컷) + 데모 컴포넌트
   - `api.ts`: `callApi`로 API 함수 + 응답 타입, 상태 코드별 한국어 안내 문장
   - `ReservationsDemo.tsx`: `Button size="big"` 하나, `Conclusion`, `ResultNumbers`(출처 필수), 전문 용어는 `DevDetails` 안에
5. **장 목록**: `apps/web/lib/site.ts`의 `CHAPTERS`에 추가 (머리말·이전/다음 장 링크가 자동으로 생김)
6. **문서**: 이 문서 3장에 흐름 한 단락, 필요하면 `docs/`에 설명 문서
7. **확인**: `pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build`

## 5. 테스트

- `pnpm test` = turbo가 세 패키지의 테스트를 실행
  - api: `tsc -p tsconfig.spec.json`으로 `dist-test/`에 컴파일 → `node --test`로 모든 `*.spec.js`. 테스트 파일은 모듈의 `test/` 폴더
  - web: `tsx --test lib/*.test.ts app/*/*.test.ts` (순수 함수, API 오류 문장)
  - sdk: `tsx --test src/index.test.ts`
- DB·Redis 통합 테스트(쿠폰 동시성, 토큰 회전, 포인트, 결제, 캐시)는 `apps/api/.env`의 `DATABASE_URL`/`REDIS_URL`을 읽습니다. 연결이 안 되면 **skip**, CI에선 `REQUIRE_DATABASE=true`라 **실패**.
- 통합 테스트는 `test-…-<pid>` 같은 자기 이름의 행·키만 만들고 끝나면 지웁니다.

## 6. CI와 배포

- CI: `.github/workflows/ci.yml` — PR과 main push마다 MySQL 8.4 + Redis 7.4 서비스 → `prisma migrate deploy` → `format:check` → `typecheck` → `lint` → `test` → `build` → 운영 모드 API 스모크(`/health`, 관리자 키 401/201) + API Docker 이미지 빌드. `gh run list -b main -L 2`로 확인.
- 배포: 웹은 Vercel(`NEXT_PUBLIC_API_URL` 필수), API는 EC2 Docker(`deploy/compose.sh`, Caddy HTTPS, 시작 시 마이그레이션 자동), DB는 RDS 또는 같은 EC2의 MySQL 컨테이너, Redis는 같은 compose의 컨테이너. 전체 절차: [deploy.md](deploy.md).
- 작업 규칙: 브랜치 → `--no-ff` 머지 → 강제 푸시 금지 → CI 초록 확인.

## 7. 알려진 한계

- **서버 한 대 전제**: 시뮬레이션 "한 번에 하나"·쿨다운·전역 한도(`common/rate-limit`)와 3장 SSE 알림(`EventBus`)은 프로세스 메모리에 있습니다. API를 여러 대로 늘리면 Redis 등으로 옮겨야 합니다.
- **IP별 한도**는 `@nestjs/throttler` 메모리 저장소. 프록시 뒤에선 `TRUST_PROXY`가 맞아야 합니다.
- **시뮬레이션은 공용 데이터**: 1·4장 버튼은 `sim-*` 쿠폰·지갑을 매번 리셋합니다. 여러 사람이 동시에 보면 서로의 결과를 덮어씁니다(그래서 한 번에 하나 + 쿨다운).
- **single-flight 코드가 두 벌**: `apps/api/src/common/utils/single-flight.ts`와 `apps/web/lib/single-flight.ts`(같은 내용, 각자 테스트). 공유 패키지로 뺄 만큼 크지 않아 그대로 둡니다.
- **"지난 실측 기록"**(`public/data/*.json`, 각 Demo의 `RECORDED_*`)은 손으로 갱신합니다. 측정 환경은 맥북 M1 Pro 로컬.
- 첫 화면의 만든 사람 정보는 `TODO(author)` 자리표시(사진·이름·이력서)로 남아 있습니다.
- 벤치마크 파일 이름(`stage2-ingest.md`, `stage3-coupon.md`)은 예전 단계 이름입니다(링크가 많아 유지).
- 웹 `next dev`가 "workspace root" 경고를 띄울 수 있습니다(상위 폴더에 다른 lockfile이 있을 때). 동작에는 영향 없음.
