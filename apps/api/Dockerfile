# API 운영 이미지. 빌드 컨텍스트는 저장소 루트:
#   docker build -f apps/api/Dockerfile -t bv-api .
# EC2가 t4g(ARM)면 EC2에서 바로 빌드하거나, 다른 머신에선 --platform linux/arm64 로 빌드한다.

FROM node:20-alpine AS base
RUN apk add --no-cache openssl && corepack enable && corepack prepare pnpm@9.14.4 --activate
WORKDIR /repo

# 1) 의존성 설치 — 매니페스트만 먼저 복사해서 소스가 바뀌어도 이 레이어는 캐시
FROM base AS dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @bv/api...

# 2) 빌드 → 운영 의존성만 담은 독립 폴더(/out)로 추출 (pnpm deploy: 워크스페이스 링크를 실제 파일로 풀어줌)
FROM dependencies AS build
COPY packages/tsconfig packages/tsconfig
COPY apps/api apps/api
RUN pnpm --filter @bv/api build \
  && pnpm --filter @bv/api deploy --prod /out \
  && cd /out \
  && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma \
  && cp /repo/apps/api/docker/start.sh ./start.sh \
  && chmod 755 ./start.sh

# 3) 실행 이미지: 소스/빌드 도구 없이 dist + 운영 node_modules + prisma 마이그레이션만
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# root가 아닌 node 사용자(uid 1000)로 실행
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini: PID 1에서 SIGTERM을 Node로 전달 → enableShutdownHooks로 DB 연결을 정리하고 종료
ENTRYPOINT ["/sbin/tini", "--", "/app/start.sh"]
