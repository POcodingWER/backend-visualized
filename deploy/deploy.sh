#!/usr/bin/env bash
# API 무중단 배포 (blue-green). EC2에서 ubuntu 사용자로 실행한다.
#
#   ./deploy/deploy.sh <커밋 SHA 40자>
#   ./deploy/deploy.sh current        # 같은 이미지로 다시 띄우기 (production.env를 바꾼 뒤)
#
# 롤백도 같은 명령에 예전 커밋 SHA를 넣으면 된다 (그 커밋의 이미지가 GHCR에 있어야 함).
#
# 하는 일
#   1) GHCR에서 그 커밋의 API 이미지를 받는다 (서버에서 빌드하지 않음)
#   2) 지금 쉬고 있는 색(blue <-> green)에 새 이미지를 붙여 띄운다
#      → 컨테이너가 시작하면서 prisma migrate deploy를 한 번 실행한다 (apps/api/docker/start.sh)
#   3) Caddy 컨테이너 안에서 새 색의 /health가 200이 될 때까지 기다린다 (docker 내부 네트워크)
#   4) Caddy가 보낼 곳(upstream.caddy)을 새 색으로 바꾸고 caddy reload → 연결을 끊지 않고 설정만 바뀐다
#   5) 예전 색에 걸려 있던 요청이 끝나도록 잠깐 기다렸다가 예전 색을 멈춘다
#
# 중간에 실패하면 Caddy는 계속 예전 색을 보고 있으므로 서비스는 그대로다.
set -euo pipefail
cd "$(dirname "$0")/.."

registry_image="ghcr.io/pocodingwer/backend-visualized-api"
upstream_file="deploy/caddy/upstream.caddy"
drain_seconds=10

log() { echo "[deploy $(date +%T)] $*"; }
compose() { ./deploy/compose.sh "$@"; }

# 지금 서비스 중인 색 (upstream 파일이 없으면 none = blue-green 첫 배포)
active=none
if [[ -f "$upstream_file" ]]; then
  active=$(sed -n 's/^reverse_proxy api_\(blue\|green\):4000.*/\1/p' "$upstream_file")
fi

sha="${1:-}"
# current: 지금 이미지 그대로 다른 색으로 다시 띄운다 (deploy/production.env를 바꾼 뒤 무중단 반영할 때)
if [[ "$sha" == current && "$active" != none ]]; then
  sha=$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "backend-visualized-api:$active")
fi
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "사용법: ./deploy/deploy.sh <커밋 SHA 40자 | current>   (받은 값: '${sha}')" >&2
  exit 1
fi

write_upstream() { # $1 = blue | green
  local tmp
  tmp=$(mktemp deploy/caddy/.upstream.XXXXXX)
  cat > "$tmp" <<CADDY
# deploy/deploy.sh가 만든 파일 (git 미추적). 지금 서비스 중인 색: $1
reverse_proxy api_$1:4000 {
	health_uri /health
	health_interval 30s
}
CADDY
  chmod 644 "$tmp"
  mv "$tmp" "$upstream_file" # mv는 한 번에 바뀌므로 Caddy가 반쯤 쓴 파일을 읽을 일이 없다
}

if [[ "$active" == blue ]]; then next=green; else next=blue; fi
log "지금: ${active}  →  새로 띄울 색: ${next}  (이미지 ${sha:0:7})"

# ── 1) 이미지 받기 ────────────────────────────────────────────────────────
if docker pull -q "$registry_image:$sha"; then
  log "GHCR에서 이미지를 받았습니다"
elif docker image inspect "$registry_image:$sha" > /dev/null 2>&1; then
  log "GHCR에서 못 받았지만 서버에 같은 이미지가 남아 있어 그대로 씁니다"
elif [[ "$(git rev-parse HEAD)" == "$sha" ]]; then
  # GHCR 패키지가 아직 private 이거나 GHCR 장애일 때를 위한 비상용. 느리고 메모리를 많이 쓴다
  echo "FALLBACK_LOCAL_BUILD: $registry_image:$sha 를 받을 수 없어서 서버에서 빌드합니다"
  docker build -q -f apps/api/Dockerfile --label "org.opencontainers.image.revision=$sha" \
    -t "$registry_image:$sha" . > /dev/null
else
  echo "$registry_image:$sha 를 받을 수 없습니다 (GHCR에 그 커밋 이미지가 없거나 패키지가 private)" >&2
  exit 1
fi
docker tag "$registry_image:$sha" "backend-visualized-api:$next"

# ── 2) 새 색 띄우기 ───────────────────────────────────────────────────────
# --no-deps: mysql/redis는 건드리지 않는다. --force-recreate: 같은 색의 예전 컨테이너가 있으면 새 이미지로 다시 만든다
compose up -d --no-deps --force-recreate "api_$next"

# ── 3) 새 색이 건강해질 때까지 기다리기 (최대 2분) ─────────────────────────
log "api_$next 의 /health 를 기다립니다"
healthy=false
for _ in $(seq 1 60); do
  if compose exec -T caddy wget -q -O /dev/null "http://api_$next:4000/health" 2> /dev/null; then
    healthy=true
    break
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "backend-visualized-api_$next-1")" != true ]]; then
    break # 컨테이너가 죽었다 (마이그레이션 실패, 환경 변수 오류 등) → 더 기다릴 필요 없음
  fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  echo "api_$next 가 건강해지지 않았습니다. 예전 색(${active})이 계속 서비스합니다. 최근 로그:" >&2
  compose logs --no-color --tail 40 "api_$next" >&2 || true
  compose stop "api_$next" || true
  exit 1
fi
log "api_$next 정상"

# ── 4) Caddy가 새 색으로 보내도록 바꾸기 ───────────────────────────────────
write_upstream "$next"
# caddy 컨테이너 설정(마운트 등)이 바뀐 커밋이면 여기서 한 번 다시 만들어진다 (평소엔 아무 일 없음)
compose up -d caddy
# 방금 새로 만들어진 caddy는 관리 API(:2019)가 뜨기까지 1~2초 걸려서 reload가 거절될 수 있다 → 몇 번 다시 시도
reloaded=0
for _ in $(seq 1 15); do
  if compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2> /dev/null; then
    reloaded=1
    break
  fi
  sleep 1
done
if [ "$reloaded" != 1 ]; then
  echo "caddy reload 실패 (upstream.caddy는 이미 api_$next 를 가리킴)" >&2
  compose logs --tail 30 caddy >&2
  exit 1
fi
log "Caddy → api_$next 로 전환"

# 바깥에서 들어오는 길(Caddy, HTTPS)로도 확인
api_domain=$(sed -n 's/^API_DOMAIN=//p' deploy/production.env)
curl -fsS --max-time 10 --resolve "$api_domain:443:127.0.0.1" "https://$api_domain/health" > /dev/null
log "https://$api_domain/health 정상"

# ── 5) 예전 색 정리 ───────────────────────────────────────────────────────
sleep "$drain_seconds" # 예전 색에서 처리 중이던 요청이 끝날 시간
if [[ "$active" == blue || "$active" == green ]]; then
  compose stop "api_$active"
  log "api_$active 정지 (다음 배포 때 다시 쓰임)"
fi
# blue-green 이전의 단일 api 컨테이너가 남아 있으면 정리 (처음 한 번만 해당)
if docker inspect backend-visualized-api-1 > /dev/null 2>&1; then
  docker rm -f backend-visualized-api-1 > /dev/null
  log "예전 단일 api 컨테이너 정리"
fi

# 디스크 정리: GHCR 이미지는 최근 3개만 남긴다 (빠른 롤백용). 사용 중인 이미지는 지워지지 않는다
docker images "$registry_image" --format '{{.Tag}}' | tail -n +4 | while read -r old_tag; do
  docker rmi "$registry_image:$old_tag" > /dev/null 2>&1 || true
done
docker image prune -f > /dev/null

# DB 백업 cron도 repo의 내용과 맞춘다 (실패해도 배포는 성공으로 둔다)
./deploy/install-backup-cron.sh || log "경고: 백업 cron 설치 실패 (./deploy/install-backup-cron.sh 확인)"

compose ps
# 배포 직후 메모리 (Actions 로그에서 바로 보이게. 실패해도 배포는 성공으로 둔다)
docker stats --no-stream --format 'MEM {{.Name}} {{.MemUsage}} CPU {{.CPUPerc}}' || true
free -m | sed -n '1,3p' || true

# 배포 뒤 30분 동안 5초마다 서버 상태를 기록한다 (메모리·/health·컨테이너별 CPU). 다음 배포 때 그 기록을 요약해서 보여 준다.
# → 배포 직후 문제나 부하 테스트 때 무슨 일이 있었는지 서버에 들어가지 않고 Actions 로그로 본다
if ls /tmp/bv-watch/*.log > /dev/null 2>&1; then
  echo "── 지난 배포 뒤 기록 ──"
  ./deploy/diagnose.sh report 2>&1 | tail -n 75 || true
fi
./deploy/diagnose.sh watch 1800 || true
echo "DEPLOYED_SHA=$sha COLOR=$next"
