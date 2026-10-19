#!/bin/sh
# 컨테이너 시작: 마이그레이션 적용(prisma migrate deploy) → API 실행
# DB가 아직 준비 안 됐을 수 있으므로(같은 compose의 MySQL, 막 만든 RDS) 몇 번 재시도한다.
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  attempt=1
  max_attempts="${MIGRATION_MAX_ATTEMPTS:-20}"
  until ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "[start] prisma migrate deploy failed after ${attempt} attempts" >&2
      exit 1
    fi
    echo "[start] database not ready (attempt ${attempt}/${max_attempts}), retrying in 3s..." >&2
    attempt=$((attempt + 1))
    sleep 3
  done
else
  echo "[start] RUN_MIGRATIONS=false → skipping prisma migrate deploy"
fi

exec node dist/main.js
