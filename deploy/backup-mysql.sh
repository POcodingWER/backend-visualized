#!/usr/bin/env bash
# MySQL 백업 (EC2에서 ubuntu 사용자로 실행, cron이 매일 04:00 KST에 부른다)
#
#   ./deploy/backup-mysql.sh
#
# 하는 일
#   1) mysql 컨테이너 안에서 mysqldump (--single-transaction: 테이블을 잠그지 않고 한 시점의 스냅샷)
#      비밀번호는 컨테이너 안의 MYSQL_ROOT_PASSWORD를 그 안에서 읽는다 → 이 셸·로그·ps에 안 나온다
#   2) 서버에서 gzip → backups/<db>-YYYYMMDD-HHMMSS-KST.sql.gz (chmod 600)
#      .partial로 쓰고 끝까지 성공했을 때만 이름을 바꾼다 (반쯤 쓰인 백업이 남지 않게)
#   3) 7일 지난 백업 삭제
#   4) deploy/production.env에 BACKUP_S3_BUCKET이 있으면 S3에도 올린다 (인스턴스 역할 권한 필요, 없으면 건너뜀)
#
# 2GB 서버라 nice/ionice로 우선순위를 낮춰서 API 응답을 방해하지 않게 한다.
set -euo pipefail
cd "$(dirname "$0")/.."

backup_dir="${BACKUP_DIR:-/opt/backend-visualized/backups}"
keep_days="${BACKUP_KEEP_DAYS:-7}"
env_file="deploy/production.env"

log() { echo "[backup $(TZ=Asia/Seoul date '+%F %T KST')] $*"; }
fail() {
  log "실패: $*"
  logger -t backend-visualized-backup "FAILED: $*" 2> /dev/null || true
  exit 1
}

# production.env에서 필요한 값만 꺼낸다 (파일 전체를 source하지 않음 → 비밀값이 이 셸에 안 들어옴)
env_value() { sed -n "s/^$1=//p" "$env_file" | tail -n 1; }

db=$(env_value MYSQL_DATABASE)
db="${db:-backend_visualized}"
s3_bucket=$(env_value BACKUP_S3_BUCKET)
s3_prefix=$(env_value BACKUP_S3_PREFIX)
s3_prefix="${s3_prefix:-mysql}"

# cron이 두 번 겹쳐 돌지 않게
exec 9> /tmp/backend-visualized-backup.lock
flock -n 9 || fail "이미 다른 백업이 돌고 있음"

umask 077
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

stamp=$(TZ=Asia/Seoul date +%Y%m%d-%H%M%S)
file="$backup_dir/$db-$stamp-KST.sql.gz"
tmp="$file.partial"
trap 'rm -f "$tmp"' EXIT

started=$(date +%s)
log "시작: $db → $(basename "$file")"

# --databases를 쓰지 않는다 → 덤프에 CREATE DATABASE/USE가 없어서 다른 이름의 DB에도 복원할 수 있다
# shellcheck disable=SC2016  # $MYSQL_ROOT_PASSWORD는 컨테이너 안에서 풀려야 한다
if ! ./deploy/compose.sh exec -T mysql \
  sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec nice -n 19 mysqldump -uroot \
      --single-transaction --quick --routines --triggers --events \
      --no-tablespaces --set-gtid-purged=OFF "$1"' _ "$db" \
  | nice -n 19 ionice -c3 gzip -6 > "$tmp"; then
  fail "mysqldump 오류"
fi

# 끝까지 써졌는지 확인: gzip이 멀쩡하고 마지막 줄이 "Dump completed"
gzip -t "$tmp" || fail "gzip 파일이 깨졌음"
zcat "$tmp" | tail -n 1 | grep -q '^-- Dump completed' || fail "덤프가 끝까지 안 써졌음"

chmod 600 "$tmp"
mv "$tmp" "$file"
trap - EXIT

size=$(du -h "$file" | cut -f1)
log "완료: $(basename "$file") ($size, $(($(date +%s) - started))초)"

# 오래된 백업 정리 (keep_days일보다 오래된 것)
find "$backup_dir" -maxdepth 1 -name "$db-*-KST.sql.gz" -mtime "+$((keep_days - 1))" -print -delete \
  | sed 's|^|[backup] 오래돼서 삭제: |'
find "$backup_dir" -maxdepth 1 -name '*.partial' -mmin +60 -delete

# 서버 밖(S3)에도 한 부 (선택)
if [[ -n "$s3_bucket" ]]; then
  command -v aws > /dev/null || fail "BACKUP_S3_BUCKET이 있는데 aws CLI가 없음 (sudo snap install aws-cli --classic)"
  if aws s3 cp "$file" "s3://$s3_bucket/$s3_prefix/$(basename "$file")" --only-show-errors; then
    log "S3 업로드: s3://$s3_bucket/$s3_prefix/$(basename "$file")"
  else
    fail "S3 업로드 실패 (로컬 백업은 남아 있음)"
  fi
fi

logger -t backend-visualized-backup "OK $(basename "$file") $size" 2> /dev/null || true
