#!/usr/bin/env bash
# 매일 백업 cron 설치 (몇 번 실행해도 결과가 같음). deploy.sh가 배포 때마다 부른다.
#
#   ./deploy/install-backup-cron.sh
set -euo pipefail
cd "$(dirname "$0")/.."

src=deploy/cron/backend-visualized-backup
dst=/etc/cron.d/backend-visualized-backup
backup_dir=/opt/backend-visualized/backups

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

if [[ "$(timedatectl show -p Timezone --value 2> /dev/null)" != Asia/Seoul ]]; then
  echo "경고: 서버 시간대가 Asia/Seoul이 아닙니다 → cron 04:00이 KST가 아님 (sudo timedatectl set-timezone Asia/Seoul)" >&2
fi

if sudo -n cmp -s "$src" "$dst" 2> /dev/null; then
  echo "백업 cron 그대로 ($dst)"
else
  # cron.d 파일은 root 소유 644여야 cron이 읽는다
  sudo -n install -m 644 -o root -g root "$src" "$dst"
  echo "백업 cron 설치/갱신: $dst"
fi
