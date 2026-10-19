# backend-visualized

> 백엔드 작동 원리를 **재현·측정·시각화**하는 플레이그라운드 — mini GA(Google Analytics) backbone

브라우저 SDK → API → DB → 대시보드로 이어지는 작은 이벤트 수집 파이프라인(미니 GA)을 뼈대로 삼고,
그 위에서 동시성·인덱스·배치 insert·멱등키·인증 토큰 같은 백엔드 개념을 직접 재현하고 k6로 측정해 시각화합니다.

## 기술 스택

| 영역        | 기술                                                     |
| ----------- | -------------------------------------------------------- |
| 언어        | TypeScript (전체)                                        |
| 모노레포    | pnpm workspace + Turborepo                               |
| 프론트엔드  | `apps/web` — Next.js (App Router)                        |
| 백엔드      | `apps/api` — NestJS (REST, GraphQL 미사용)               |
| DB / ORM    | MySQL 8 + Prisma (`apps/api/prisma`)                     |
| SDK         | `packages/sdk` — 트래킹 SDK (TS 패키지)                  |
| 공통 설정   | `packages/tsconfig`, 루트 ESLint(flat config) / Prettier |
| 로컬 인프라 | Docker Compose (MySQL), `apps/api/Dockerfile`            |
| 부하 테스트 | k6 (Stage 3)                                             |

## 디렉터리 구조

```
apps/
  web/        Next.js App Router (대시보드)
  api/        NestJS REST API + Prisma
packages/
  sdk/        트래킹 SDK
  tsconfig/   공유 tsconfig
docker-compose.yml   로컬 MySQL
```

## 로컬 실행

요구사항: Node 20+, pnpm 9+, Docker

```bash
# 1. 의존성 설치
pnpm install

# 2. 환경변수
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 3. MySQL 기동
docker compose up -d

# 4. 마이그레이션 적용 (Prisma client 생성 포함)
pnpm --filter @bv/api prisma:migrate

# 5. 개발 서버 (web: http://localhost:3000, api: http://localhost:4000)
pnpm dev

# 헬스체크 (DB 연결 포함, DB down 시 503)
curl http://localhost:4000/health
```

기타 명령: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm format`

API Docker 이미지 빌드 (레포 루트에서): `docker build -f apps/api/Dockerfile -t bv-api .`

## 로드맵

- **Stage 0 — 세팅**: 모노레포, Next.js / NestJS / Prisma / MySQL, 공통 lint·format, Docker Compose ✅
- **Stage 1 — 얇게 관통 + 배포**: SDK → API → DB → 대시보드를 최소 기능으로 끝까지 연결하고 배포 (로컬 slice ✅, 배포 ⏳)
  (web: Vercel / api: AWS EC2 Docker + RDS)
- **Stage 2 — 미니 GA 심화**: SDK 배치·beacon·오프라인 재전송, 배치 insert, rate limit, 일별 집계 테이블+cron, SSE 실시간, 차트 대시보드, 수집 벤치마크 ✅ (세션·퍼널·리텐션은 이후)
- **Stage 3 — 데모 (k6로 측정·시각화)**
  - 쿠폰 발급 동시성 (락, 트랜잭션 격리)
  - 인덱스 유무에 따른 쿼리 성능
  - batch insert vs 단건 insert
  - 멱등키 (중복 요청 방지)
  - 인증 토큰 (세션 / JWT / refresh) 흐름 시각화
- **Stage 4 — 기록**: 실험 결과와 배운 점 정리

## Stage 1 체험하기 (로컬)

```bash
docker compose up -d            # MySQL (host 3307)
pnpm install
pnpm --filter @bv/api prisma:deploy
pnpm build
# 터미널 1: API (:4000)  — apps/api/.env 의 DATABASE_URL, WEB_ORIGIN 사용
cd apps/api && set -a && . ./.env && set +a && node dist/main.js
# 터미널 2: Web (:3000)  — NEXT_PUBLIC_API_URL (기본 http://localhost:4000)
pnpm --filter @bv/web start
```

- http://localhost:3000 접속 시 `page_view` 자동 전송, 버튼으로 `button_click` 전송, 아래 대시보드에서 집계 확인(새로고침 버튼)
- API
  - `POST /events` — body `{ "name": string, "sessionId": string, "properties"?: object }` (검증 실패 시 400)
  - `GET /events/stats?from=&to=` — `{ total, byName: [{ name, count }] }`

```bash
curl -XPOST localhost:4000/events -H 'Content-Type: application/json' \
  -d '{"name":"page_view","sessionId":"s1","properties":{"path":"/"}}'
curl localhost:4000/events/stats
```

## Stage 2 체험하기 (미니 GA 심화)

```bash
docker compose up -d
pnpm install
pnpm --filter @bv/api prisma:deploy   # EventDailyStat 마이그레이션 포함
pnpm build
cd apps/api && node --env-file=.env dist/main.js     # 터미널 1 (:4000)
pnpm --filter @bv/web start                          # 터미널 2 (:3000)
```

무엇이 추가됐나

- **SDK (`@bv/sdk`)**: `createTracker({ endpoint, maxBatchSize?, flushIntervalMs?, maxStoredEvents? })`
  - `track()`은 메모리 큐에 적재 → N개(기본 20) 또는 X ms(기본 5000)마다 `POST /events/batch`
  - `pagehide` / `visibilitychange(hidden)` 시 `navigator.sendBeacon`(text/plain, preflight 없음), 실패 시 fetch keepalive
  - 네트워크 오류·429·5xx 배치는 localStorage에 보관(최대 500개) → `online` 이벤트나 다음 페이지 로드 때 재전송
  - `flush()`, `destroy()` 제공
- **API**
  - `POST /events/batch` — `{ events: [...] }` 1~100개, 이벤트별 검증, Prisma `createMany`로 한 번에 insert → `202 { inserted }`
  - 수집 엔드포인트(`POST /events`, `/events/batch`)에 `@nestjs/throttler` rate limit (IP당 `THROTTLE_LIMIT`(기본 200)회 / `THROTTLE_TTL_MS`(기본 10초), 초과 시 429)
  - `EventDailyStat`(date, name, count, uniqueSessions, unique(date,name)) 일별 집계 테이블
  - 집계 잡: 5분마다 cron(어제~오늘 재집계), `INSERT ... SELECT ... ON DUPLICATE KEY UPDATE`로 멱등 upsert
  - `POST /admin/aggregate?from=&to=` — 수동 집계(로컬 테스트용, 인증 없음 → 운영 전 보호 필요)
  - `GET /events/stats/daily?from=&to=` — 집계 테이블에서 읽음 (기본 최근 7일, 날짜는 **UTC 기준**)
  - `GET /events/stream` — SSE, 이벤트 저장 시 `event: ingested` `{ added, at }` push (프로세스 내 emitter → 단일 인스턴스 전제)
- **Web**: 전체/이름별 카운트, 최근 7일 일별 누적 막대 차트(recharts), SSE 실시간 카운터, "일별 집계 지금 실행" 버튼, 데모 버튼(단건 / x50 / flush)

```bash
curl -XPOST localhost:4000/events/batch -H 'Content-Type: application/json' \
  -d '{"events":[{"name":"page_view","sessionId":"s1"},{"name":"button_click","sessionId":"s1"}]}'
curl -XPOST localhost:4000/admin/aggregate
curl localhost:4000/events/stats/daily
curl -N localhost:4000/events/stream     # 다른 터미널에서 이벤트를 보내면 push 확인
pnpm test                                # API 단위 테스트 (배치 검증, 날짜 범위/집계 시리즈)
```

벤치마크 (10,000 이벤트, M1 Pro 로컬): 단건 `POST /events`(동시 10) **16~19초** vs `POST /events/batch`(100개씩, 동시 10) **0.25~0.29초**,
DB 레벨 `create` 순차 70~75초 vs `createMany` 1.0~1.2초. 자세한 내용·재현 방법: [docs/benchmarks/stage2-ingest.md](docs/benchmarks/stage2-ingest.md)
