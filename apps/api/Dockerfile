# Build context: repo root  ->  docker build -f apps/api/Dockerfile -t bv-api .
FROM node:20-alpine AS base
RUN apk add --no-cache openssl && corepack enable && corepack prepare pnpm@9.14.4 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @bv/api...
COPY packages/tsconfig packages/tsconfig
COPY apps/api apps/api
RUN pnpm --filter @bv/api build \
  && pnpm --filter @bv/api deploy --prod /out \
  && cp -r apps/api/dist /out/dist \
  && cd /out && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma || npx -y prisma@6 generate --schema prisma/schema.prisma

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
EXPOSE 4000
CMD ["node", "dist/main.js"]
