#!/usr/bin/env bash
# 백업이 진짜로 복원되는지 확인한다 (운영 DB는 건드리지 않음)
#
#   ./deploy/restore-test.sh                 # 가장 최근 백업
#   ./deploy/restore-test.sh <백업파일.sql.gz>
#
# 같은 MySQL 안에 임시 DB(backend_visualized_restore_test)를 만들어 복원하고,
# 운영 DB와 테이블별 행 수(COUNT(*))를 비교한 뒤 임시 DB를 지운다.
# 백업 이후에 운영 DB에 쓰기가 있었다면 그 테이블은 숫자가 다를 수 있다 (데모 로그 등).
set -euo pipefail
cd "$(dirname "$0")/.."

backup_dir="${BACKUP_DIR:-/opt/backend-visualized/backups}"
env_file="deploy/production.env"
live=$(sed -n 's/^MYSQL_DATABASE=//p' "$env_file" | tail -n 1)
live="${live:-backend_visualized}"
scratch="${live}_restore_test"

file="${1:-$(find "$backup_dir" -maxdepth 1 -name "$live-*-KST.sql.gz" | sort | tail -n 1)}"
[[ -f "$file" ]] || { echo "백업 파일이 없습니다: '$file'" >&2; exit 1; }
[[ "$scratch" != "$live" ]] || { echo "임시 DB 이름이 운영 DB와 같습니다" >&2; exit 1; }

# 컨테이너 안에서 root로 mysql 실행 (비밀번호는 컨테이너 env에서)
# shellcheck disable=SC2016
sql() {
  ./deploy/compose.sh exec -T mysql \
    sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B "$@"' _ "$@"
}

cleanup() { sql -e "DROP DATABASE IF EXISTS \`$scratch\`" && echo "임시 DB $scratch 삭제"; }
trap cleanup EXIT

echo "복원: $(basename "$file") → $scratch"
started=$(date +%s)
sql -e "DROP DATABASE IF EXISTS \`$scratch\`; CREATE DATABASE \`$scratch\`"
# shellcheck disable=SC2016
zcat "$file" | nice -n 19 ./deploy/compose.sh exec -T mysql \
  sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$1"' _ "$scratch"
echo "복원 끝 ($(($(date +%s) - started))초)"

# 테이블별 정확한 행 수 (information_schema의 TABLE_ROWS는 추정값이라 안 씀)
count_rows() {
  local schema=$1 query
  query=$(sql -e "SET SESSION group_concat_max_len = 1000000; SELECT GROUP_CONCAT(CONCAT('SELECT ''', table_name, ''', COUNT(*) FROM \`$schema\`.\`', table_name, '\`') SEPARATOR ' UNION ALL ') FROM information_schema.tables WHERE table_schema='$schema' AND table_type='BASE TABLE'")
  sql -e "SET SESSION group_concat_max_len = 1000000; $query" | sort
}

export LC_ALL=C
live_rows=$(count_rows "$live")
restored_rows=$(count_rows "$scratch")

printf '%-40s %10s %10s\n' TABLE LIVE RESTORED
join -t $'\t' -a1 -a2 -e '-' -o 0,1.2,2.2 <(echo "$live_rows") <(echo "$restored_rows") \
  | awk -F'\t' '{ printf "%-40s %10s %10s%s\n", $1, $2, $3, ($2 == $3 ? "" : "   <- 다름") }'

if [[ "$live_rows" == "$restored_rows" ]]; then
  echo "RESTORE_TEST=PASS ($(echo "$live_rows" | wc -l | tr -d ' ')개 테이블 행 수 모두 일치)"
else
  echo "RESTORE_TEST=DIFF (백업 이후 운영 DB에 쓰기가 있었는지 확인)"
  exit 2
fi
