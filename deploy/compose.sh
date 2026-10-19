#!/bin/sh
# docker compose 래퍼: 항상 운영 compose 파일과 deploy/production.env 를 사용
#   ./deploy/compose.sh up -d --build
#   ./deploy/compose.sh --profile local-db up -d --build
#   ./deploy/compose.sh logs -f api
set -eu
cd "$(dirname "$0")/.."
if [ ! -f deploy/production.env ]; then
  echo "deploy/production.env 가 없습니다. deploy/production.env.example 을 복사해서 채우세요." >&2
  exit 1
fi
exec docker compose -f docker-compose.prod.yml --env-file deploy/production.env "$@"
