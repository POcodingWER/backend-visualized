#!/usr/bin/env bash
# 서버 상태 보기 (부하 테스트·장애 때 증거 남기기). 읽기만 하고, recover만 컨테이너를 다시 띄운다.
# GitHub Actions의 Diagnose workflow가 SSM으로 root 권한으로 실행한다 (서버에서 직접 sudo로 실행해도 됨).
#
#   sudo ./deploy/diagnose.sh snapshot        # 지금 상태 한 번: 메모리, 재시작/OOM, 에러 로그, MySQL·Redis
#   sudo ./deploy/diagnose.sh watch 900       # 뒤에서 약 5초마다 기록 시작 (900초 동안) → 바로 끝남
#   sudo ./deploy/diagnose.sh report          # 마지막 watch 기록의 최고값 + 15초 간격 표 + snapshot
#   (deploy.sh가 배포 끝에 지난 기록을 report로 보여 주고, 새 watch 1800을 시작한다)
#   sudo ./deploy/diagnose.sh recover         # API가 응답 없으면 지금 색 API 재시작 + mysql/redis/caddy up -d
#
# 비밀값은 출력하지 않는다: MySQL 비밀번호는 컨테이너 안의 환경 변수를 그 안에서만 쓴다 (backup-mysql.sh와 같은 방식).
# production.env에서는 API_DOMAIN 한 줄만 읽는다.
set -uo pipefail
# Actions에서는 main의 이 파일을 /tmp로 꺼내 실행하므로 APP_DIR로 위치를 받는다
cd "${APP_DIR:-$(dirname "$0")/..}"

watch_dir=/tmp/bv-watch
compose() { ./deploy/compose.sh "$@"; }
active=$(sed -n 's/.*api_\(blue\|green\):4000.*/\1/p' deploy/caddy/upstream.caddy 2> /dev/null | head -n 1)
active=${active:-blue}
api_domain=$(sed -n 's/^API_DOMAIN=//p' deploy/production.env)

# Caddy(HTTPS)를 거쳐 서버 안에서 /health 응답 코드와 걸린 시간
health() {
  curl -s -o /dev/null -w '%{http_code} %{time_total}s' --max-time 5 \
    --resolve "$api_domain:443:127.0.0.1" "https://$api_domain/health" || echo "000 timeout"
}

snapshot() {
  echo "== $(date '+%F %T %Z') 지금 색: api_$active · /health: $(health)"
  echo "== 메모리 (MB)"
  free -m | sed -n '1,3p'
  echo "== load: $(cut -d' ' -f1-3 /proc/loadavg)"
  echo "== 컨테이너 (상태 · 재시작 횟수 · OOMKilled · 시작 시각)"
  docker ps -a --filter name=backend-visualized --format '{{.Names}}' | while read -r name; do
    docker inspect -f "$name {{.State.Status}} restarts={{.RestartCount}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}} started={{.State.StartedAt}}" "$name"
  done
  echo "== docker stats"
  docker stats --no-stream --format '{{.Name}} mem={{.MemUsage}} cpu={{.CPUPerc}} pids={{.PIDs}}'
  echo "== 최근 1시간 OOM · die 이벤트"
  docker events --since 1h --until "$(date +%s)" --filter event=oom --filter event=die \
    --format '{{.Time}} {{.Action}} {{.Actor.Attributes.name}} exit={{.Actor.Attributes.exitCode}}' 2> /dev/null | tail -n 20
  journalctl -k --since '-1h' --no-pager 2> /dev/null | grep -iE 'out of memory|oom-kill|killed process' | tail -n 10
  echo "== API 경고·오류 로그 (최근 2000줄 중 warn 이상, 마지막 15줄)"
  compose logs --no-color --tail 2000 "api_$active" 2> /dev/null |
    grep -E '"level":(40|50|60)|WARN|ERROR' | tail -n 15 | cut -c1-400
  echo "== MySQL"
  compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -e "
    SHOW GLOBAL STATUS WHERE Variable_name IN
      (\"Threads_connected\",\"Threads_running\",\"Max_used_connections\",\"Aborted_connects\",\"Slow_queries\",\"Questions\",\"Uptime\");
    SHOW VARIABLES WHERE Variable_name IN (\"max_connections\",\"innodb_buffer_pool_size\");
    SELECT \"events_rows\", COUNT(*) FROM backend_visualized.Event;"' 2>&1 | tr '\t' '=' | paste -sd' ' -
  echo "== Redis"
  compose exec -T redis redis-cli INFO 2> /dev/null | tr -d '\r' |
    grep -E '^(used_memory_human|maxmemory_human|connected_clients|rejected_connections|evicted_keys|instantaneous_ops_per_sec|uptime_in_seconds):' | paste -sd' ' -
}

watch_loop() {
  # local 한 줄에 같이 쓰면 end를 계산할 때 seconds가 아직 비어 있다 (0초 → 바로 끝남). 그래서 나눠 쓴다
  local seconds=$1 file=$2
  local end=$(($(date +%s) + seconds))
  echo "# time health secs memUsedMB availMB swapMB load1 | 컨테이너 mem cpu …" > "$file"
  while [ "$(date +%s)" -lt "$end" ]; do
    local mem swap containers
    mem=$(free -m | awk '/^Mem:/ {print $3" "$7}')
    swap=$(free -m | awk '/^Swap:/ {print $3}')
    containers=$(docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' |
      sed -E 's/backend-visualized-//; s/-1 / /; s# / [0-9.]+[GM]iB##' | paste -sd'|' -)
    echo "$(date +%T) $(health) $mem $swap $(cut -d' ' -f1 /proc/loadavg) | $containers" >> "$file"
    sleep 3
  done
  echo "# 끝 $(date +%T)" >> "$file"
}

case "${1:-snapshot}" in
  snapshot) snapshot ;;
  watch)
    seconds=${2:-900}
    [[ "$seconds" =~ ^[0-9]+$ && "$seconds" -le 3600 ]] || { echo "watch 초는 0~3600" >&2; exit 1; }
    mkdir -p "$watch_dir"
    file="$watch_dir/$(date +%Y%m%d-%H%M%S).log"
    setsid nohup bash -c "$(declare -f health watch_loop); api_domain='$api_domain'; watch_loop $seconds '$file'" > /dev/null 2>&1 &
    echo "watch 시작: $file (${seconds}초, 5초 간격)"
    ;;
  report)
    file=$(ls -1t "$watch_dir"/*.log 2> /dev/null | head -n 1)
    [ -n "$file" ] || { echo "watch 기록 없음" >&2; exit 1; }
    echo "== watch 기록: $file ($(grep -vc '^#' "$file")줄)"
    # 최고값: 메모리 사용, 최저 가용, 스왑, load, /health가 200이 아닌 줄 수, 가장 느린 /health
    awk '!/^#/ { if ($4>mu) mu=$4; if (min==""||$5<min) min=$5; if ($6>sw) sw=$6; if ($7>ld) ld=$7;
      if ($2!="200") bad++; t=$3; sub("s","",t); if (t+0>slow) {slow=t+0; at=$1} }
      END { printf "최고 메모리 사용 %sMB · 최저 가용 %sMB · 최고 스왑 %sMB · 최고 load %s · /health 200 아님 %d번 · 가장 느린 /health %.2fs (%s)\n", mu, min, sw, ld, bad, slow, at }' "$file"
    echo "== API 컨테이너 메모리 최고"
    grep -oE 'api_(blue|green) [0-9.]+[GM]iB' "$file" |
      awk '{v=$2; u=substr(v,length(v)-2); n=v+0; if (u=="GiB") n*=1024; if (n>m) {m=n; s=v}} END {print "api 최고 " s}'
    # 표는 30줄 안팎으로 (Actions 로그에서 한눈에): 기록이 길면 간격을 넓힌다
    lines=$(grep -vc '^#' "$file")
    step=$(((lines + 29) / 30))
    [ "$step" -ge 1 ] || step=1
    echo "== 약 $((step * 5))초 간격"
    awk -v step="$step" '/^#/ || (NR-2)%step==0' "$file" | cut -c1-200
    echo
    snapshot
    ;;
  recover)
    echo "== 복구 전: /health $(health)"
    if [[ "$(health)" != 200* ]]; then
      echo "api_$active 재시작"
      compose --profile "$active" restart "api_$active" || compose --profile "$active" up -d --no-recreate "api_$active"
    fi
    # 문서에 적힌 대로: mysql/redis/caddy가 멈췄으면 다시 띄운다 (떠 있으면 아무 일 없음)
    compose up -d
    for _ in $(seq 1 30); do [[ "$(health)" == 200* ]] && break; sleep 2; done
    echo "== 복구 후: /health $(health)"
    snapshot
    ;;
  *)
    echo "사용법: $0 snapshot | watch <초> | report | recover" >&2
    exit 1
    ;;
esac
