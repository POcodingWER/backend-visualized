# API 구조 (apps/api) — 프론트엔드 개발자를 위한 지도

NestJS는 처음 보면 데코레이터와 파일이 많아 보이지만, 규칙은 몇 개 안 됩니다.
**URL 첫 단어 = 폴더 이름 = 모듈** 이고, 폴더 안의 파일 이름만 보면 그 파일이 하는 일을 알 수 있습니다.

## 폴더 구조

```
apps/api/src/
  main.ts                  서버 시작: 바디 파서, CORS, 전역 ValidationPipe
  app.module.ts            모든 모듈을 모으는 뿌리 (프론트의 App.tsx)

  events/                  /events/*      3장 묶음배송 (이벤트 수집·집계)
    events.module.ts
    events.controller.ts   라우트 (/events, /events/batch, /events/stats, /events/stream,
                                   /events/demo/*, /events/admin/aggregate)
    events.service.ts      저장·통계
    dto/events.dto.ts
    lib/                   이 모듈만 쓰는 도우미
      aggregation.service.ts  일별 집계 (5분 cron 포함)
      event-bus.ts            SSE로 보낼 "저장됨" 알림
      date-range.ts           KST 날짜 계산 (순수 함수)
    test/                  events.dto.spec.ts, date-range.spec.ts
  auth/                    /auth/*        2장 손목밴드 (액세스·리프레시 토큰)
    auth.module.ts  auth.controller.ts  auth.service.ts
    dto/auth.dto.ts
    lib/                   access-token.guard.ts (이 모듈 전용 가드), refresh-token.store.ts,
                           password.ts, auth.config.ts
    test/refresh-token.store.spec.ts
  coupons/                 /coupons/*     1장 티켓팅 (선착순 쿠폰)
    coupons.module.ts  coupons.controller.ts  coupons.service.ts
    dto/coupons.dto.ts
    lib/coupon-strategies.ts  발급 전략 4종 (Nest 없이 PrismaClient만 → 테스트·벤치도 사용)
    test/coupon-strategies.spec.ts
  points/                  /points/*      4장 포인트 통장
    points.module.ts  points.controller.ts  points.service.ts  dto/  test/
  payments/                /payments      5장 결제 버튼 두 번 (Idempotency-Key)
    payments.module.ts  payments.controller.ts  payments.service.ts  dto/  test/
  cache-demo/              /cache-demo/*  6장 맛집 대기표 (Redis 캐시)
    cache-demo.module.ts  cache-demo.controller.ts  cache-demo.service.ts  dto/  test/
  health/                  /health        DB 연결 확인 (로직이 쿼리 한 줄이라 서비스 없음)
    health.module.ts  health.controller.ts

  prisma/                  MySQL 연결 하나 (PrismaService, 전역)
  redis/                   Redis 연결 하나 (RedisService, cache-demo가 import)
  common/                  여러 모듈이 같이 쓰는 것 (CommonModule, 전역)
    guards/                admin-api-key.guard.ts      관리자 키 검사
    rate-limit/            usage-limits(.service).ts   서버 전체 한도·쿨다운 (IP별 한도는 @nestjs/throttler)
    config/                environment.ts, app-environment.ts  환경 변수 검증 (시작할 때 한 번)
    utils/                 single-flight.ts            진행 중인 Promise 공유
```

## 무엇을 어디에 두나

| 만들려는 것                                                 | 위치                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 새 URL (`/orders/...`)                                      | `src/orders/` 모듈을 새로 만든다. URL 첫 단어와 폴더 이름을 맞춘다                   |
| 기존 기능의 데모·관리자 버튼                                | 그 기능 모듈 안 `/<모듈>/demo/...`, `/<모듈>/admin/...`                              |
| 요청 본문·쿼리 모양 + 검증                                  | `<모듈>/dto/<모듈>.dto.ts`                                                           |
| 비즈니스 로직, DB 읽기·쓰기                                 | `<모듈>/<모듈>.service.ts`                                                           |
| 그 모듈만 쓰는 도우미 (알고리즘, 가드, 설정, 저장소 클래스) | `<모듈>/lib/` (`coupons/lib/coupon-strategies.ts`)                                   |
| 두 모듈 이상이 쓰는 가드·한도·유틸                          | `common/guards`, `common/rate-limit`, `common/utils`                                 |
| 외부 연결 (DB, Redis)                                       | `prisma/`, `redis/` 처럼 자기 모듈                                                   |
| 테스트                                                      | 모듈 최상위 `test/` 폴더 (`lib/` 파일의 테스트도 여기), 이름은 `<대상 파일>.spec.ts` |

## 요청 하나가 지나가는 길

`POST /payments` (5장 결제 버튼)을 예로 들면:

```
브라우저 fetch
  → main.ts       바디 파서(JSON), CORS
  → 가드           ThrottlerGuard: IP당 요청 수 초과면 여기서 429 (관리자 라우트는 AdminApiKeyGuard)
  → 파이프         ValidationPipe + PayDto: orderId 형식, amount 범위가 틀리면 400 (컨트롤러는 실행도 안 됨)
  → 컨트롤러       PaymentsController.pay: 헤더 확인, 결과를 HTTP 응답(상태 코드·헤더)으로 바꿈
  → 서비스         PaymentsService.pay: 'processing' 행 INSERT → 가짜 PG 대기 → 'paid'
  → Prisma        this.prisma.payment.create(...) → SQL
  → MySQL
```

6장 캐시는 서비스에서 한 갈래가 더 있습니다: `CacheDemoService` → `RedisService`(ioredis) → Redis(`GET`, `SET EX`, `SET NX`, `DEL`), 없을 때만 Prisma → MySQL.
서비스나 컨트롤러가 `throw new ConflictException(...)` 같은 예외를 던지면 Nest가 알아서 JSON 에러 응답(409 등)으로 바꿉니다.

## Nest 개념 ↔ 프론트엔드 비유

| Nest                         | 하는 일                                                             | 프론트에 비유하면                                                                   |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 모듈 (`*.module.ts`)         | 컨트롤러·서비스를 한 묶음으로 등록                                  | 기능 폴더 + 그 폴더의 `index` / 라우트 그룹. `app.module.ts`는 `App.tsx`            |
| 컨트롤러 (`*.controller.ts`) | URL과 메서드를 함수에 연결, HTTP 응답 모양 결정                     | Next.js `app/api/.../route.ts`의 `GET`/`POST` 핸들러, 또는 라우터의 페이지 컴포넌트 |
| 서비스 (`*.service.ts`)      | 실제 로직과 DB 작업. HTTP를 모른다                                  | 커스텀 훅 / API 클라이언트 모듈 (UI 없이 로직만)                                    |
| DTO (`dto/*.dto.ts`)         | 요청 본문·쿼리의 모양 + 검증 규칙 (`class-validator` 데코레이터)    | TS 타입 + zod 스키마를 한 클래스에 합친 것. `ValidationPipe`가 `schema.parse` 역할  |
| 가드 (`*.guard.ts`)          | 컨트롤러 전에 "통과/거절"만 결정 (레이트 리밋, 관리자 키, 로그인)   | Next.js `middleware.ts`의 리다이렉트, 라우트 보호용 `<RequireAuth>`                 |
| 인터셉터                     | 컨트롤러 앞뒤를 감싸 응답을 바꾸거나 시간 측정 (이 프로젝트엔 없음) | fetch 래퍼 / axios 인터셉터                                                         |
| 파이프                       | 들어온 값을 변환·검증 (`ValidationPipe`, 전역 1개)                  | 폼 제출 전 `schema.parse`                                                           |
| 프로바이더 / DI              | `@Injectable()` 클래스를 Nest가 하나 만들어 생성자에 넣어 줌        | React Context Provider + `useContext`: 직접 `new` 하지 않고 위에서 받아 씀          |

DI가 실제로 하는 일: `constructor(private readonly payments: PaymentsService)`라고 쓰면 Nest가 모듈의 `providers`에서 `PaymentsService`를 찾아(없으면 만들어서) 넣어 줍니다. 그래서 테스트에선 `new PaymentsService(new PrismaService())`처럼 손으로 넣어 만들 수 있습니다.

## DTO란

DTO(Data Transfer Object)는 "이 요청은 이런 모양이어야 한다"를 적은 클래스입니다.

```ts
export class PayDto {
  @Matches(/^order-[a-z0-9-]{4,40}$/) orderId!: string;
  @Type(() => Number) @IsInt() @Min(100) @Max(1_000_000) amount!: number;
}
```

- 타입 역할: 컨트롤러에서 `dto.amount`가 `number`로 보인다.
- 검증 역할: `main.ts`의 전역 `ValidationPipe`가 요청마다 검사하고, 틀리면 컨트롤러 전에 400. 모르는 필드가 오면 거절(`forbidNonWhitelisted`).
- 프론트로 치면 `type Pay = z.infer<typeof paySchema>`와 `paySchema.parse(body)`를 한 번에.

모든 DTO 파일 첫 줄에 이 문서를 가리키는 한 줄 주석이 있습니다.

## 왜 `entities/` 폴더가 없나

DB 모델은 `apps/api/prisma/schema.prisma` 한 곳에만 적습니다. `prisma generate`가 여기서 `@prisma/client`의 타입(`Payment`, `PointWallet` …)을 만들어 주고, 모든 모듈이 그 타입을 같이 씁니다.
TypeORM 스타일의 `*.entity.ts`를 따로 만들면 같은 모델을 두 번 적게 되고, 한쪽만 고치면 서로 어긋납니다. 그래서 만들지 않습니다.

## 이름·위치 규칙

1. **폴더 = URL 첫 단어 = 모듈.** `/points/...`는 `src/points/`, `PointsModule`. 데모·관리자 전용 라우트도 그 기능 아래 (`/events/demo/aggregate`, `/events/admin/aggregate`).
2. 모듈 폴더 최상위에는 `<이름>.module.ts`, `<이름>.controller.ts`, `<이름>.service.ts`, `dto/`, `test/`, `lib/`만 둔다. 클래스 이름은 파일과 맞춘다 (`points.service.ts` → `PointsService`). 필요 없는 파일·폴더는 만들지 않는다 (빈 `lib/` 금지).
3. 컨트롤러는 HTTP만: 라우트, DTO, 가드·한도, 상태 코드, 헤더. 로직과 DB는 서비스로.
4. 파일은 한 파일이 두 가지 일을 할 때만 나눈다. 리포지토리 계층, 인터페이스, `index.ts` 배럴은 만들지 않는다.
5. **모듈 전용 도우미 → `<모듈>/lib/`, 여러 모듈이 공유 → `common/`.** (`auth/lib/password.ts`, `common/utils/single-flight.ts`)
6. 테스트는 모듈 최상위 `test/` 폴더에 `<대상 파일>.spec.ts` (`points/test/points.service.spec.ts`, `coupons/test/coupon-strategies.spec.ts`). `common/`은 하위 폴더마다 `test/` (`common/config/test/environment.spec.ts`).
   - 실행: `pnpm --filter @bv/api test` (컴파일 후 `node --test`로 모든 `*.spec.js` 실행).
   - 빌드(`tsconfig.build.json`)는 `src/**/test/**`를 빼서 `dist`에 테스트가 들어가지 않는다.
   - DB·Redis를 쓰는 테스트는 자기가 만든 행·키를 `after`에서 지운다.

AI 어시스턴트용 같은 규칙: [`.cursor/rules/architecture.mdc`](../.cursor/rules/architecture.mdc)
