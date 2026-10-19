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
- **Stage 1 — 얇게 관통 + 배포**: SDK → API → DB → 대시보드를 최소 기능으로 끝까지 연결하고 배포
  (web: Vercel / api: AWS EC2 Docker + RDS)
- **Stage 2 — 미니 GA 심화**: 세션·퍼널·리텐션 등 집계, 대시보드 고도화
- **Stage 3 — 데모 (k6로 측정·시각화)**
  - 쿠폰 발급 동시성 (락, 트랜잭션 격리)
  - 인덱스 유무에 따른 쿼리 성능
  - batch insert vs 단건 insert
  - 멱등키 (중복 요청 방지)
  - 인증 토큰 (세션 / JWT / refresh) 흐름 시각화
- **Stage 4 — 기록**: 실험 결과와 배운 점 정리
