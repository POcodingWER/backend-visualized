# backend-visualized — 버튼 하나 뒤에서

백엔드 문제 여섯 가지를 브라우저 버튼 하나로 **실제 서버·DB에서 일으키고, 고친 결과를 잰 숫자로 보여주는** 그림책 사이트입니다.

| 장  | 페이지        | 다루는 것                                            | API 모듈     |
| --- | ------------- | ---------------------------------------------------- | ------------ |
| 1   | `/ticketing`  | 선착순 쿠폰 동시성 (비관적·낙관적 락, 원자적 UPDATE) | `coupons`    |
| 2   | `/wristband`  | 액세스·리프레시 토큰, 회전과 재사용 감지             | `auth`       |
| 3   | `/delivery`   | 이벤트 수집 SDK, 배치 insert, 레이트 리밋, 일별 집계 | `events`     |
| 4   | `/ledger`     | 포인트 원장(내역)과 대사                             | `points`     |
| 5   | `/double-pay` | 멱등키(Idempotency-Key)로 중복 결제 막기             | `payments`   |
| 6   | `/cache`      | Redis 캐시, 무효화, 캐시 스탬피드                    | `cache-demo` |

## 기술 스택

TypeScript 전체 · pnpm workspace + Turborepo · `apps/web` Next.js 15 (App Router) · `apps/api` NestJS + Prisma + MySQL 8 · Redis 7 + ioredis (6장) · `packages/sdk` 트래킹 SDK · ESLint(flat) / Prettier · `node:test`

## 빠른 시작

```bash
pnpm install
cp apps/api/.env.example apps/api/.env          # DATABASE_URL을 내 MySQL(3306)로
cp apps/web/.env.example apps/web/.env.local
docker compose up -d redis                       # 6장용 Redis (bv-redis, 6380)
pnpm --filter @bv/api prisma:generate
pnpm --filter @bv/api prisma:deploy
pnpm dev                                         # web :3000 · api :4000
```

자세한 설치, 장별 흐름, 새 장 추가 방법, 테스트, 알려진 한계: **[docs/handover.md](docs/handover.md)**

## 문서

- [docs/decisions.md](docs/decisions.md) — 장마다 고른 방법 · 포기한 방법 · 배운 것 (실측 숫자 근거)
- [docs/handover.md](docs/handover.md) — 인수인계: 로컬 실행, 어디에 무엇이 있나, 장별 흐름, 새 장 추가, CI·배포, 한계
- [docs/architecture.md](docs/architecture.md) — 폴더·이름 규칙, Nest 개념 ↔ 프론트 비유, 원자 단위 설계
- [docs/deploy.md](docs/deploy.md) — Vercel + EC2 Docker + RDS/MySQL 배포
- [docs/auth-tokens.md](docs/auth-tokens.md) — 2장 토큰 설계 · [docs/chapters-4-6.md](docs/chapters-4-6.md) — 4~6장 설명
- [docs/benchmarks/](docs/benchmarks/) — 1장 쿠폰(`ticketing-coupon.md`), 3장 수집(`delivery-batching.md`) 실측
- AI 어시스턴트 규칙: [.cursor/rules/](.cursor/rules/)

## 명령

`pnpm dev` · `pnpm format:check` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build`

API Docker 이미지 (레포 루트): `docker build -f apps/api/Dockerfile -t bv-api .`
