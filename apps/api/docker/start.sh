#!/bin/sh
# 컨테이너 시작: 마이그레이션 적용(prisma migrate deploy, 선택) → API 실행
# 7장: 여러 인스턴스 중 첫 번째만 마이그레이션 실행 (RUN_MIGRATIONS=false인 인스턴스는 건너뜀).
# Prisma migrate deploy는 DB advisory lock을 쓰므로 동시 실행 시 한 인스턴스만 실제 마이그레이션하고
# 나머지는 대기 후 통과하지만, 불필요한 경쟁을 피하려고 명시적으로 분리.
# expand-only 스키마(새 컬럼/테이블 추가만, 삭제·이름 변경 없음)라면 인스턴스 2가 먼저 시작해도
# 기존 컬럼/테이블로 동작하므로 안전 (expand → 배포 → contract 규칙).
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
