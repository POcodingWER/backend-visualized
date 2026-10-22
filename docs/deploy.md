# 배포 가이드 — 웹은 Vercel, API는 AWS EC2(Docker), DB는 RDS 또는 같은 EC2의 MySQL

```
브라우저 ──HTTPS──▶ Vercel (apps/web, Next.js)
   │
   └──HTTPS (fetch, credentials: include)──▶ EC2 :443 Caddy ──▶ api_blue_1·_2 / api_green_1·_2 :4000 (NestJS, Docker)
                                                                  │
                                              같은 EC2의 mysql · redis 컨테이너 (또는 RDS)

GitHub Actions ──이미지──▶ GHCR        GitHub Actions ──OIDC → SSM──▶ EC2 deploy/deploy.sh (blue-green)
```

- **Caddy**가 `API_DOMAIN`의 HTTPS 인증서(Let's Encrypt)를 자동 발급·갱신합니다.
- API 컨테이너는 시작할 때 `prisma migrate deploy`를 실행한 뒤 서버를 띄웁니다 (DB가 늦게 뜨면 3초 간격으로 재시도).
- 운영 모드(`NODE_ENV=production`)에서 필수 환경 변수가 없거나 위험한 기본값이면 **API가 시작하지 않고** 무엇이 문제인지 모두 출력합니다.

---

## 0. 준비해서 알려주실 것

| #   | 항목                                                                                                        | 용도                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | **AWS 계정** (EC2·RDS·Elastic IP를 만들 수 있는 IAM 사용자 또는 콘솔 접근)                                  | 서버·DB                                                                                                                |
| 2   | **리전 선택** (권장: 서울 `ap-northeast-2`)                                                                 | 지연 시간                                                                                                              |
| 3   | **API 도메인** 1개 (예: `api.example.com`)와 그 DNS를 수정할 수 있는 권한 (가비아, Route 53, Cloudflare 등) | HTTPS 인증서는 도메인이 있어야 발급됩니다. 도메인이 아직 없으면 `<IP를-로>.sslip.io`로 임시 HTTPS 가능 (1장 Ubuntu 절) |
| 4   | **Vercel 계정** + 이 GitHub 저장소 접근 연결                                                                | 웹 배포                                                                                                                |
| 5   | DB 방식 선택: **RDS** 또는 **EC2 안의 MySQL 컨테이너**                                                      | 비용/관리 트레이드오프 (아래 3장)                                                                                      |
| 6   | (선택) 웹 커스텀 도메인 (예: `app.example.com`)                                                             | 쿠키를 같은 사이트로 만들어 엄격한 쿠키 설정에서도 로그인 유지가 확실해짐 (4장)                                        |
| 7   | Let's Encrypt 알림용 이메일 (`ACME_EMAIL`)                                                                  | 인증서 만료 경고 수신                                                                                                  |

비밀값(`JWT_ACCESS_SECRET`, `ADMIN_API_KEY`, DB 비밀번호)은 EC2에서 직접 생성하면 되므로 따로 전달하지 않아도 됩니다.

---

## 1. EC2 만들기

1. **인스턴스 유형**: `t4g.small` (ARM, 2 vCPU / 2 GiB) 권장. x86이 필요하면 `t3.small`.
   - MySQL 컨테이너까지 같이 돌리면 `t4g.small`(2 GiB)에서 동작하도록 MySQL 메모리를 줄여 두었습니다(`innodb-buffer-pool-size=256M`). 여유가 필요하면 `t4g.medium`.
   - API 이미지는 GitHub Actions가 구워 GHCR에 올리고 서버는 받기만 합니다(7-1장). 그래도 비상용 서버 빌드(`FALLBACK_LOCAL_BUILD`)를 생각하면 `t4g.micro`(1 GiB)는 스왑 2 GB가 필수입니다.
2. **AMI**: Ubuntu Server 24.04 LTS (Arm) — 실제 배포에 쓴 것. Amazon Linux 2023도 되지만 설치 명령이 다릅니다 (아래 두 절).
3. **스토리지**: gp3 20 GiB.
4. **키 페어**: 새로 만들고 `.pem` 파일 보관 (SSH 접속용).
5. **보안 그룹 (인바운드)**:

   | 포트          | 소스            | 이유                                    |
   | ------------- | --------------- | --------------------------------------- |
   | 22 (SSH)      | **내 IP만**     | 관리 접속                               |
   | 80 (HTTP)     | 0.0.0.0/0, ::/0 | Let's Encrypt 인증 + HTTPS로 리다이렉트 |
   | 443 (TCP/UDP) | 0.0.0.0/0, ::/0 | API (HTTPS, HTTP/3)                     |

   4000(API)과 3306(MySQL)은 **열지 않습니다**. API는 Caddy를 통해서만 접근해야 클라이언트 IP(X-Forwarded-For) 위조를 막을 수 있습니다.

6. **Elastic IP** 할당 → 인스턴스에 연결. 재시작해도 IP가 바뀌지 않습니다.
7. **DNS**: `api.example.com`의 **A 레코드**를 Elastic IP로 설정.

### EC2에 Docker 설치 (Amazon Linux 2023, 다른 선택지)

```bash
ssh -i my-key.pem ec2-user@<Elastic IP>
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user && newgrp docker
# docker compose 플러그인
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -sSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
# (t4g.micro 또는 MySQL 컨테이너를 같이 쓸 때) 스왑 2GB
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
```

### EC2에 Docker 설치 (Ubuntu 24.04, 실제 배포에 쓴 순서)

2026-10-20 `t4g.small`(arm64) + Ubuntu 24.04 + 같은 EC2의 MySQL 컨테이너 + sslip.io로 배포할 때 실행한 그대로입니다.

```bash
ssh -i ~/.ssh/<key>.pem ubuntu@<EC2 IP>   # 키 권한이 넓으면 거부됨: chmod 400 ~/.ssh/<key>.pem

# 1) 패키지 최신화
sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade

# 2) 스왑 2GB (fstab에 등록해 재부팅 후에도 유지) + swappiness 10
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf && sudo sysctl -p /etc/sysctl.d/99-swappiness.conf

# 3) 시간대 + 자동 보안 업데이트
sudo timedatectl set-timezone Asia/Seoul
sudo apt-get install -y unattended-upgrades
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' | sudo tee /etc/apt/apt.conf.d/20auto-upgrades

# 4) Docker Engine + compose/buildx 플러그인 (공식 저장소)
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu          # 다시 로그인하면 sudo 없이 docker 사용
sudo systemctl enable --now docker containerd

# 5) 코드
sudo mkdir -p /opt/backend-visualized && sudo chown ubuntu:ubuntu /opt/backend-visualized
git clone https://github.com/POcodingWER/backend-visualized.git /opt/backend-visualized
```

`deploy/production.env`는 서버에서 비밀값을 직접 생성해서 만듭니다 (값을 화면에 출력하지 않음):

```bash
cd /opt/backend-visualized && umask 077
cp deploy/production.env.example deploy/production.env
# 아래 값들을 채우기: hex 비밀번호는 DATABASE_URL에 그대로 넣어도 URL 인코딩이 필요 없음
#   COMPOSE_PROFILES=local-db
#   API_DOMAIN=<IP-대시>.sslip.io        (IP의 점을 -로: 도메인이 생기면 이 줄만 교체)
#   WEB_ORIGIN=http://localhost:3000   VERCEL_ORIGIN=   (Vercel 주소가 생기면 채우기)
#   MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)   MYSQL_PASSWORD=$(openssl rand -hex 24)
#   DATABASE_URL=mysql://app:<MYSQL_PASSWORD>@mysql:3306/backend_visualized
#   JWT_ACCESS_SECRET=$(openssl rand -base64 48)  ADMIN_API_KEY=$(openssl rand -hex 32)
vi deploy/production.env
chmod 600 deploy/production.env
```

실행 (API 이미지는 GitHub Actions가 GHCR에 올린 것을 받기만 함, 7-1장):

```bash
./deploy/compose.sh up -d                # mysql/redis/caddy (COMPOSE_PROFILES=local-db 라 mysql도 같이 뜸)
./deploy/deploy.sh "$(git rev-parse HEAD)"   # API: GHCR 이미지 받아서 api_blue_1·_2로 시작 + Caddy 연결
./deploy/compose.sh ps                   # api_blue_1·_2/mysql/redis (healthy), 공개 포트는 caddy 80/443 뿐
./deploy/compose.sh logs caddy | grep 'certificate obtained'
curl https://<IP-대시>.sslip.io/health # {"status":"ok","db":{"status":"up",...}}
```

> **도메인 없이 HTTPS**: [sslip.io](https://sslip.io)는 `1-2-3-4.sslip.io` → `1.2.3.4`으로 응답하는 공개 DNS라
> Caddy가 Let's Encrypt 인증서를 바로 받습니다. 현재 서버에는 Elastic IP가 연결돼 있습니다 (2026-10-20, 주소는 이 문서에 적지 않음). Elastic IP가 없으면 인스턴스를 **중지/시작**할 때 공인 IP가 바뀌므로
> `API_DOMAIN`도 바꿔야 합니다 (재부팅은 IP 유지).

---

## 2. API 배포 (EC2)

```bash
git clone https://github.com/POcodingWER/backend-visualized.git
cd backend-visualized
cp deploy/production.env.example deploy/production.env
# 비밀값 생성
echo "JWT_ACCESS_SECRET=$(openssl rand -base64 48)"
echo "ADMIN_API_KEY=$(openssl rand -hex 32)"
vi deploy/production.env   # 아래 5장 표를 보고 채우기
```

```bash
# RDS 사용
./deploy/compose.sh up -d
# 또는 같은 EC2의 MySQL 컨테이너 사용 (DATABASE_URL 호스트를 mysql 로)
./deploy/compose.sh --profile local-db up -d

./deploy/deploy.sh "$(git rev-parse HEAD)"   # API (blue-green, 7-1장)
./deploy/compose.sh ps                 # api_blue_1·_2 또는 api_green_1·_2가 (healthy) 인지 확인
./deploy/compose.sh logs -f api_blue_1   # [config] 요약 줄과 경고 확인
curl https://api.example.com/health
```

업데이트: main에 push하면 CI 성공 후 **자동 무중단 배포**됩니다 (7-1장). 수동으로 하려면 `git pull && ./deploy/deploy.sh "$(git rev-parse HEAD)"` (마이그레이션은 새 컨테이너 시작 시 자동 적용).

CORS 출처 추가 (예: Vercel 배포 후): `deploy/production.env`의 `VERCEL_ORIGIN=https://<앱>.vercel.app` → `./deploy/deploy.sh current` (같은 이미지를 다른 색으로 다시 띄워 무중단 반영). 현재 `https://backend-visualized.vercel.app`.
compose가 `WEB_ORIGIN` + `,VERCEL_ORIGIN`(비어 있으면 생략)으로 합쳐 API에 넘깁니다.

관리자 API (임의 기간 재집계):

```bash
curl -X POST -H "X-Admin-Api-Key: $ADMIN_API_KEY" "https://api.example.com/events/admin/aggregate?from=2026-10-01&to=2026-10-19"
```

**Redis (6장 캐시)**: `docker-compose.prod.yml`에 `redis` 컨테이너가 같이 뜹니다 (redis:7.4-alpine, 포트 외부 비공개,
디스크 저장 끔, `maxmemory 64mb` + `allkeys-lru`). `deploy/production.env`에 `REDIS_URL=redis://redis:6379/0`.
캐시라 컨테이너가 재시작돼 비어도 다음 요청이 DB에서 다시 채웁니다. 관리형이 필요하면 ElastiCache(Valkey/Redis)를
EC2와 같은 VPC에 만들고 보안 그룹 6379 ← EC2만 허용, `REDIS_URL=rediss://<엔드포인트>:6379` (전송 암호화 시 `rediss`).

```bash
./deploy/compose.sh exec redis redis-cli ping      # PONG
./deploy/compose.sh exec redis redis-cli --scan    # bv:menu:* 키만 보여야 정상 (TTL 5초)
```

> 다른 머신에서 이미지를 빌드할 경우, t4g(ARM)용은 `docker buildx build --platform linux/arm64 -f apps/api/Dockerfile .`

---

## 3. DB 선택: RDS vs 같은 EC2의 MySQL 컨테이너

|      | RDS (MySQL 8.x)          | EC2 안의 MySQL 컨테이너 (`--profile local-db`) |
| ---- | ------------------------ | ---------------------------------------------- |
| 비용 | 인스턴스 + 스토리지 추가 | 추가 비용 없음 (EC2 디스크 사용)               |
| 백업 | 자동 백업·스냅샷         | 직접 (`mysqldump` 크론 등)                     |
| 장애 | EC2와 분리               | EC2가 죽으면 DB도 같이                         |
| 권장 | 오래 운영할 서비스       | 데모/포트폴리오, 비용 최소화                   |

**RDS를 쓸 때**

1. RDS → 데이터베이스 생성 → MySQL 8.4, 템플릿 "프리 티어" 또는 "개발/테스트", `db.t4g.micro`, 단일 AZ, gp3 20 GiB.
2. **퍼블릭 액세스: 아니요**. EC2와 같은 VPC.
3. RDS 보안 그룹 인바운드: 3306 ← **EC2의 보안 그룹**만 허용.
4. 초기 데이터베이스 이름 `backend_visualized`, 마스터 사용자/비밀번호 지정.
5. `DATABASE_URL=mysql://<user>:<password>@<RDS 엔드포인트>:3306/backend_visualized`
   - 비밀번호에 `@ : / ? #` 같은 문자가 있으면 URL 인코딩하세요 (예: `@` → `%40`).

**MySQL 컨테이너를 쓸 때**: `deploy/production.env`의 `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`를 채우고
`DATABASE_URL=mysql://app:<MYSQL_PASSWORD>@mysql:3306/backend_visualized`. 데이터는 `mysql-data` 볼륨에 남습니다.

**MySQL Workbench로 보기 (SSH 터널)**: mysql 컨테이너는 EC2의 `127.0.0.1:3306`에만 publish 돼 있어
인터넷에서는 접속할 수 없고(보안 그룹도 22/80/443만), SSH로만 들어갈 수 있습니다.

```bash
# 터미널로 터널을 열 때 (Mac의 13306 → EC2의 127.0.0.1:3306). 다 쓰면 Ctrl+C
ssh -i ~/.ssh/backend-visualized.pem -N -L 13306:127.0.0.1:3306 ubuntu@<IP>
```

또는 Workbench 내장 터널: Connection Method **Standard TCP/IP over SSH**

| 항목              | 값                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------- |
| SSH Hostname      | `<IP>:22`                                                                                    |
| SSH Username      | `ubuntu`                                                                                     |
| SSH Key File      | `~/.ssh/backend-visualized.pem`                                                              |
| MySQL Hostname    | `127.0.0.1`                                                                                  |
| MySQL Server Port | `3306`                                                                                       |
| Username          | `app` (비밀번호 = EC2 `deploy/production.env`의 `MYSQL_PASSWORD`, Workbench 키체인에만 저장) |
| Default Schema    | `backend_visualized`                                                                         |

- docker가 publish한 포트로 들어온 접속은 MySQL에서 **docker 브리지 게이트웨이 IP**(예: `app@172.18.0.1`)로 보이므로 계정 host가 `'%'`여야 합니다. 공식 이미지가 만든 `app@'%'`, `root@'%'`가 그 조건을 만족합니다.
- 평소엔 `app`(backend_visualized DB 권한만)을 쓰고, `root`는 관리 작업 때만 쓰세요.
- 보안 그룹에 3306을 열거나 `ports`를 `'3306:3306'`(=0.0.0.0)으로 바꾸지 마세요.

### 참고 비용 (서울 리전, 온디맨드, USD, 세금·데이터 전송 제외)

AWS 공식 가격표(aws.amazon.com 가격 페이지가 쓰는 공개 가격 데이터, EC2는 2026-10-15, RDS는 2026-10-06 게시분)와
[Amazon VPC 요금](https://aws.amazon.com/vpc/pricing/), [Vercel 요금](https://vercel.com/pricing)을 2026-10-19에 확인한 값입니다.
월 금액은 시간당 요금 × 730시간으로 계산한 **어림값**이며 프리 티어·크레딧·환율은 반영하지 않았습니다. 실제 청구액은 AWS 콘솔의 요금 계산기로 확인하세요.

| 항목                                             | 시간당          | 월 어림 (×730h) |
| ------------------------------------------------ | --------------- | --------------- |
| EC2 `t4g.small` (2 vCPU, 2 GiB)                  | $0.0208         | ≈ $15.2         |
| EC2 `t4g.medium` (2 vCPU, 4 GiB)                 | $0.0416         | ≈ $30.4         |
| EC2 `t3.small` (2 vCPU, 2 GiB)                   | $0.026          | ≈ $19.0         |
| EBS gp3 20 GiB                                   | $0.0912 / GB-월 | ≈ $1.8          |
| 퍼블릭 IPv4 (Elastic IP 포함, 사용 중/유휴 동일) | $0.005          | ≈ $3.7          |
| RDS MySQL `db.t4g.micro` 단일 AZ                 | $0.025          | ≈ $18.3         |
| RDS MySQL `db.t4g.small` 단일 AZ                 | $0.051          | ≈ $37.2         |
| RDS 스토리지 gp3 단일 AZ 20 GiB                  | $0.131 / GB-월  | ≈ $2.6          |
| Vercel Hobby (개인·비상업용)                     | —               | $0              |
| Vercel Pro                                       | —               | $20 / 월        |

예) `t4g.small` + MySQL 컨테이너 ≈ $21/월, `t4g.small` + RDS `db.t4g.micro` ≈ $41/월 (데이터 전송·세금 별도).

---

## 4. 웹 배포 (Vercel)

1. Vercel → **Add New → Project** → 이 GitHub 저장소 Import.
2. **Root Directory**: `apps/web` (Framework는 Next.js로 자동 인식).
3. Build/Install 명령은 `apps/web/vercel.json`에 있습니다:
   - install: `pnpm install --frozen-lockfile` (pnpm 워크스페이스 전체 설치)
   - build: `cd ../.. && pnpm turbo run build --filter=@bv/web` (`@bv/sdk`를 먼저 빌드)
4. **Environment Variables**: `NEXT_PUBLIC_API_URL=https://api.example.com` (Production, Preview 모두).
   - 빠지면 빌드가 실패하도록 해 두었습니다 (`next.config.ts`). `NEXT_PUBLIC_*`은 **빌드 시점에 박히므로** 바꾸면 재배포해야 합니다.
5. Deploy → 나온 주소(예: `https://backend-visualized.vercel.app`)를 EC2의 `VERCEL_ORIGIN`에 넣고 `./deploy/deploy.sh current` 로 API 무중단 재시작.

> Preview 배포 주소(`…-git-branch-….vercel.app`)는 매번 달라서 CORS에 막힙니다. 필요하면 그 주소를 `WEB_ORIGIN`에 쉼표로 추가하세요.

### 리프레시 쿠키와 "사이트" — 꼭 읽어주세요

브라우저는 **등록 가능한 도메인(eTLD+1)** 이 같으면 같은 사이트로 봅니다. `vercel.app`은 공개 접미사라
`my-app.vercel.app`과 `api.example.com`은 **서로 다른 사이트**입니다.

| 구성                                                        | 사이트 관계             | 쿠키 설정 (`REFRESH_COOKIE_SAME_SITE`)        |
| ----------------------------------------------------------- | ----------------------- | --------------------------------------------- |
| 로컬 `localhost:3000` ↔ `localhost:4000`                    | 같은 사이트 (포트 무관) | `lax` (개발 기본값)                           |
| `my-app.vercel.app` ↔ `api.example.com`                     | **다른 사이트**         | `none` + Secure (+ Partitioned) — 운영 기본값 |
| `app.example.com`(Vercel 커스텀 도메인) ↔ `api.example.com` | 같은 사이트             | `lax` **권장**                                |

- `none`이면 쿠키가 "서드파티 쿠키"가 됩니다. 이 API는 `Partitioned`(CHIPS) 속성을 붙여 서드파티 쿠키 제한이 있어도 동작하게 했습니다. 2026-10-21 실제 Safari(현재 버전)에서 `backend-visualized.vercel.app` 로그인 → 새로고침 후에도 로그인이 유지되는 것을 확인했습니다 (Partitioned 덕분으로 보임). 다만 **"모든 쿠키 차단" 같은 엄격한 설정이나 오래된 브라우저에서는 새로고침 후 로그인 복구가 실패할 수 있습니다** (로그인 직후 동작은 액세스 토큰이 메모리에 있어 정상). 가장 튼튼한 해결은 커스텀 도메인으로 같은 사이트를 만들고 `lax`를 쓰는 것입니다.
- 확실하게 하려면 웹에 커스텀 도메인(`app.example.com`)을 연결하고 `REFRESH_COOKIE_SAME_SITE=lax`로 바꾸세요. Vercel → Project → Settings → Domains에서 추가하고 안내대로 DNS(CNAME)를 설정하면 됩니다.

---

## 5. 환경 변수 표 (API, `deploy/production.env`)

| 변수                                                                    |   운영 필수   | 기본값 (개발 / 운영)              | 설명                                                                                                    |
| ----------------------------------------------------------------------- | :-----------: | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                          |      ✅       | —                                 | `mysql://user:password@host:3306/backend_visualized`                                                    |
| `REDIS_URL`                                                             |      ✅       | `redis://127.0.0.1:6380/0` / 없음 | 6장 캐시. `redis://` 또는 `rediss://`. compose 안이면 `redis://redis:6379/0`                            |
| `WEB_ORIGIN`                                                            |      ✅       | `http://localhost:3000` / 없음    | CORS 허용 출처. 경로 없이, 쉼표로 여러 개. 운영은 https, `*` 금지                                       |
| `VERCEL_ORIGIN`                                                         |       —       | 없음                              | compose가 `WEB_ORIGIN` 뒤에 쉼표로 붙임 (Vercel 주소용 자리)                                            |
| `COMPOSE_PROFILES`                                                      |       —       | 없음                              | `local-db`면 `--profile local-db` 없이 mysql 컨테이너도 같이 실행                                       |
| `JWT_ACCESS_SECRET`                                                     |      ✅       | 개발용 공개값 / 없음              | 32자 이상, 저장소에 적힌 기본값 금지. `openssl rand -base64 48`                                         |
| `API_DOMAIN`                                                            |  ✅ (Caddy)   | —                                 | Caddy가 HTTPS 인증서를 받을 도메인                                                                      |
| `ACME_EMAIL`                                                            |  ✅ (Caddy)   | —                                 | Let's Encrypt 인증서 알림 메일                                                                          |
| `ADMIN_API_KEY`                                                         |     선택      | 없음                              | `/events/admin/*` 호출 시 `X-Admin-Api-Key` 헤더. 없으면 개발=허용, 운영=비활성. 운영은 24자 이상       |
| `TRUST_PROXY`                                                           |       —       | `false` / compose에서 `1`         | 프록시 홉 수 또는 IP/CIDR. Caddy 뒤=1, ALB+Caddy=2. `true`는 운영에서 금지(IP 위조)                     |
| `REFRESH_COOKIE_SAME_SITE`                                              |       —       | `lax` / `none`                    | 4장 참고                                                                                                |
| `REFRESH_COOKIE_SECURE`                                                 |       —       | `false` / `true`                  | `none`이면 반드시 `true`                                                                                |
| `REFRESH_COOKIE_PARTITIONED`                                            |       —       | SameSite=None이면 `true`          | CHIPS 파티션 쿠키                                                                                       |
| `AUTH_DEMO_ENDPOINTS`                                                   |       —       | `true` / `false`                  | 토큰 탈취 시뮬레이션 등 데모 전용 API. 공개 데모 사이트라면 `true`로 명시                               |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`                                         |       —       | `20`                              | 액세스 토큰 수명 (데모라 짧음)                                                                          |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS`                                        |       —       | `86400`                           | 리프레시 토큰/쿠키 수명                                                                                 |
| `MAX_BODY_SIZE`                                                         |       —       | `200kb`                           | JSON/text 요청 본문 최대 크기 (초과 시 413)                                                             |
| `EVENTS_GLOBAL_LIMIT_PER_MINUTE`                                        |       —       | `30000`                           | 서버 전체 분당 저장 이벤트 수 (0=무제한)                                                                |
| `RATE_LIMIT_DEMO_GLOBAL_LIMIT_PER_MINUTE`                               |       —       | `20000`                           | 레이트 리밋 체험 엔드포인트 전역 분당 한도                                                              |
| `MAX_STREAM_CONNECTIONS`                                                |       —       | `200`                             | 동시 SSE(`/events/stream`) 연결 수                                                                      |
| `AGGREGATION_DEMO_COOLDOWN_MS`                                          |       —       | `10000`                           | 공개 "지금 집계 실행" 버튼 전역 쿨다운                                                                  |
| `SIMULATION_COOLDOWN_MS`                                                |       —       | `3000`                            | 1·4·6장 시뮬레이션 종료 후 전역 쿨다운 (ms)                                                             |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT`                                    |       —       | `10000` / `200`                   | IP별 기본 한도 (라우트별 `@Throttle`이 우선)                                                            |
| `SENTRY_DSN`                                                            |     선택      | 없음                              | 있으면 5xx 오류를 Sentry로 보냄 (요청 번호 태그 `request_id`). 비우면 꺼짐, 시작 로그에 `sentry=on/off` |
| `LOG_LEVEL`                                                             |       —       | `info`                            | pino 로그 단계 (`debug`·`warn` 등)                                                                      |
| `RUN_MIGRATIONS`                                                        |       —       | `true`                            | 컨테이너 시작 시 `prisma migrate deploy` 실행 여부                                                      |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `MYSQL_USER`, `MYSQL_DATABASE` | local-db일 때 | —                                 | MySQL 컨테이너 초기화용                                                                                 |

웹 (Vercel): `NEXT_PUBLIC_API_URL` (필수, 운영은 https).

---

## 6. 남용 방지 요약 (공개 데모 엔드포인트)

| 엔드포인트                                              | IP별 한도  | 전역 한도                                       |
| ------------------------------------------------------- | ---------- | ----------------------------------------------- |
| `POST /events`, `/events/batch`                         | 10초 200회 | 분당 저장 이벤트 30,000개 → 429 + `Retry-After` |
| `GET /events/stream` (SSE)                              | —          | 동시 연결 200 → 503                             |
| `POST /events/demo/aggregate` (집계 버튼)               | 분당 6회   | 전역 쿨다운 10초 → 429                          |
| `POST /events/demo/rate-limit-probe` (레이트 리밋 체험) | 10초 200회 | 분당 20,000회, DB에 쓰지 않음                   |
| `POST /coupons/simulate`                                | 10초 6회   | 동시에 1개(409) + 종료 후 쿨다운 3초(429)       |
| `POST /points/simulate`                                 | 10초 6회   | 동시에 1개(409) + 종료 후 쿨다운 3초(429)       |
| `POST /payments`                                        | 10초 200회 | 데모 결제 행은 30분 뒤 자동 삭제                |
| `POST /cache-demo/visitors`, `/cache-demo/stampede`     | 10초 6회   | 동시에 1개(409) + 종료 후 쿨다운 3초(429)       |
| `POST /auth/login`                                      | 분당 10회  | —                                               |
| `POST /events/admin/aggregate`                          | —          | `X-Admin-Api-Key` 필요                          |

- 전역 한도·IP별 한도(throttler)는 아직 **API 인스턴스 메모리**에 있어서, API 2개인 지금은 한도가 사실상 2배입니다. 시뮬레이션 "한 번에 하나"·쿨다운, 5분 집계 cron 잠금, 3장 SSE 알림은 7장에서 Redis로 옮겼습니다.
- IP별 한도는 `req.ip` 기준이라 `TRUST_PROXY`가 맞아야 합니다. 틀리면 모든 사용자가 Caddy IP 하나로 묶여 서로의 한도를 나눠 씁니다.

---

## 7. CI (GitHub Actions)

`.github/workflows/ci.yml` — PR과 main push마다:

1. MySQL 8.4 + Redis 7.4 서비스 컨테이너 → `prisma migrate deploy`
2. `pnpm format:check` → `pnpm typecheck` → `pnpm lint` → `pnpm test` (DB 통합 테스트 포함, `REQUIRE_DATABASE=true`라 DB가 없으면 실패) → `pnpm build`
3. 운영 모드로 API 실행 후 `/health`, 관리자 키 401/201 스모크 테스트
4. API Docker 이미지 빌드 확인 (push 안 함)

---

## 7-1. 자동 배포 (CD): GHCR 이미지 + OIDC + SSM + blue-green 무중단

`.github/workflows/deploy.yml` — main에 push하고 CI가 **성공**하면 자동으로 EC2에 **무중단** 배포합니다.
서버는 이미지를 **받기만** 하고 빌드하지 않습니다 (빌드는 GitHub의 ARM 러너가 함).

```
git push origin main
   │
   ▼
CI (ci.yml: typecheck · lint · test · build · Docker 이미지 빌드 확인)
   │  성공 (workflow_run, conclusion=success, event=push)
   ▼
Deploy (deploy.yml)
   ├─ target : 배포할 커밋 SHA 결정 (main에 있는 커밋인지 확인)
   ├─ image  : ubuntu-24.04-arm 러너에서 linux/arm64 빌드 → GHCR push (GITHUB_TOKEN, packages: write)
   │             ghcr.io/pocodingwer/backend-visualized-api:<40자 SHA>  (+ :main)
   └─ deploy : GitHub OIDC ──▶ AWS 역할 backend-visualized-github-deploy (1시간 임시 자격 증명)
                 └─ aws ssm send-command (AWS-RunShellScript) ──▶ EC2의 SSM Agent (root → sudo -u ubuntu)
                       git fetch && git reset --hard origin/main      # compose/Caddy 설정은 main 기준
                       ./deploy/deploy.sh <SHA>                       # 아래 blue-green
               └─ get-command-invocation 폴링 → 서버 출력의 DEPLOYED_SHA 확인 → https://…/health 200 확인
```

### blue-green 무중단 교체 (`deploy/deploy.sh`)

```
            평소                           배포 중 (수십 초)                         배포 후
 인터넷 ─▶ Caddy ─▶ api_blue_1·_2   Caddy ─▶ api_blue_1·_2 (계속 서비스)     Caddy ─▶ api_green_1·_2
                    (green 2개       api_green_1·_2 새 이미지로 시작           blue 2개 정지 (다음 배포 때 재사용)
                     꺼져 있음)        → prisma migrate deploy (_1만)
                                     → 둘 다 /health 200 확인 (caddy 안에서 wget)
                                     → upstream.caddy를 green 2개로 + caddy reload
                                     → 10초 대기 (진행 중 요청 마무리) → blue 정지
```

- `docker-compose.prod.yml`에 같은 API를 색마다 2개씩, `api_blue_1`·`api_blue_2`·`api_green_1`·`api_green_2` 네 서비스로 정의합니다 (7장. 공통 설정은 `x-api` 앵커 하나라 env·CORS(`WEB_ORIGIN`+`VERCEL_ORIGIN`)가 두 색에 똑같이 들어감).
  `profiles`가 있어서 `./deploy/compose.sh up -d`로는 API가 안 뜨고, API는 `deploy.sh`로만 교체합니다.
- 어느 색이 서비스 중인지는 `deploy/caddy/upstream.caddy` 한 파일이 정합니다 (git 미추적, deploy.sh가 생성).
  `deploy/caddy` 폴더 전체를 Caddy의 `/etc/caddy`로 마운트하므로, 파일을 바꾸고 `caddy reload`만 하면 연결을 끊지 않고 전환됩니다.
- 평소엔 API 2개, 전환하는 몇십 초 동안만 4개가 떠 있어서 2GB 메모리에서도 여유가 있습니다 (API 하나 약 140MB).
- Caddy는 `lb_policy least_conn`으로 진행 중인 요청이 적은 쪽에 보내고, 30초마다 각 API의 `/health`를 확인해 실패한 쪽은 뺍니다. 응답 헤더 `x-instance-id`로 어느 API가 받았는지 볼 수 있습니다.
- 새 색 2개 중 하나라도 건강해지지 않으면(마이그레이션 실패, env 오류 등) 스크립트가 멈추고 Caddy는 계속 예전 색을 봅니다.
- MySQL/Redis는 건드리지 않습니다 (`--no-deps`). 공개 포트는 여전히 Caddy의 80/443뿐입니다.
- SSE(`/events/stream`) 같은 오래 열린 연결은 전환 때 한 번 끊기고, 브라우저 EventSource가 자동으로 다시 연결합니다.

**마이그레이션 주의 (expand → contract)**: 새 색이 시작하면서 `prisma migrate deploy`를 실행하는 순간부터 전환이 끝날 때까지
**예전 색이 새 스키마 위에서** 잠깐 같이 돕니다. 그래서 한 번의 배포에서 컬럼 삭제·이름 변경처럼 예전 코드가 깨지는 변경을 하면 안 됩니다.

1. expand: 새 컬럼/테이블 추가 (nullable 또는 기본값) → 배포 (예전 코드도 문제없음)
2. 코드가 새 컬럼을 쓰도록 바꿔 배포
3. contract: 더 이상 안 쓰는 컬럼 삭제 → 배포

롤백해도 마이그레이션은 되돌려지지 않으므로(Prisma는 앞으로만), 이 순서를 지키면 예전 이미지로 롤백해도 안전합니다.

### 걸리는 시간 (2026-10-21 실측, GitHub Actions Deploy 기록)

Actions 목록에 보이는 시간은 **워크플로 전체**(대상 커밋 확인 + 이미지 굽기 + 서버 배포)입니다.

| 경우                                        | 워크플로 전체    | 이미지 굽기 job | 서버 배포 job |
| ------------------------------------------- | ---------------- | --------------- | ------------- |
| 예전: 서버에서 직접 빌드 (#4, job 하나)     | 2분 18초 (138초) | —               | 135초         |
| API 코드 변경 없음, 이미지 캐시 (#7·#9·#10) | 약 1분 12~13초   | 18~22초         | 37~39초       |
| API 코드 변경, 이미지 새로 굽기 (#8)        | 2분 23초 (143초) | 75초            | 51초          |

API 코드가 바뀌면 전체 시간은 예전과 비슷합니다. 달라진 점은 그동안 2GB 서버가 빌드하지 않고 서비스를 계속하고,
서버가 하는 일이 135초 → 37~51초로 줄었고, 바꿔 끼우는 동안 실패한 요청이 0번이라는 것입니다.

### GHCR 패키지 공개 여부

서버는 로그인 없이(익명으로) 이미지를 받습니다 → 서버에 GitHub 토큰을 둘 필요가 없습니다. 대신 패키지가 **Public**이어야 합니다.
이 저장소는 public이고 이미지에 `org.opencontainers.image.source` 라벨로 저장소가 연결돼 있어서, 패키지도 저장소를 따라
**처음부터 Public**이었습니다 (따로 바꾼 적 없음). 익명 pull 확인:

```bash
curl -s "https://ghcr.io/token?scope=repository:pocodingwer/backend-visualized-api:pull"   # {"token":…} 이면 Public
```

나중에 저장소를 private으로 바꾸거나 패키지가 private이 되면, image job에 경고가 뜨고 서버는 비상용으로
**직접 빌드**합니다 (`FALLBACK_LOCAL_BUILD`, 느림). 그때는
https://github.com/users/POcodingWER/packages/container/backend-visualized-api/settings →
**Danger Zone → Change visibility → Public** 으로 되돌립니다.

### 왜 SSH가 아니라 SSM?

- SSH로 배포하려면 GitHub Actions 러너(IP가 매번 바뀜)에게 22번 포트를 열어야 하고, 개인키를 GitHub Secret에 넣어야 합니다.
- SSM은 EC2의 에이전트가 AWS로 **나가는(outbound)** 연결만 쓰므로 인바운드 포트를 하나도 더 열 필요가 없고,
  누가 어떤 명령을 보냈는지 CloudTrail/SSM 기록에 남습니다.
- OIDC 덕분에 AWS Access Key 같은 장기 비밀값을 GitHub에 저장하지 않습니다. GHCR push도 job마다 새로 발급되는 `GITHUB_TOKEN`을 씁니다.

### AWS 쪽 구성 (콘솔에서 1회, 최소 권한)

| 구성 요소                                      | 내용                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| EC2 인스턴스 역할 `backend-visualized-ec2-ssm` | 관리형 정책 `AmazonSSMManagedInstanceCore`만. SSM Agent가 AWS에 등록되는 데 필요                                                            |
| IAM OIDC 공급자                                | `token.actions.githubusercontent.com`, audience `sts.amazonaws.com`                                                                         |
| 배포 역할 `backend-visualized-github-deploy`   | 신뢰 정책: `aud` = `sts.amazonaws.com`, `sub` = `repo:POcodingWER@<오너ID>/backend-visualized@<저장소ID>:ref:refs/heads/main` (아래 주의)   |
| 배포 역할 인라인 정책 `ssm-deploy-only`        | `ssm:SendCommand` → 이 인스턴스 ARN + `AWS-RunShellScript` 문서만 / `ssm:GetCommandInvocation`, `ssm:ListCommandInvocations` → `*` (조회만) |

GHCR로 바꾸면서 IAM은 하나도 늘리지 않았습니다 (이미지 저장소가 AWS 밖이라 ECR 권한이 필요 없음).

- **`sub` 형식 주의 (immutable subject)**: 이 저장소는 GitHub OIDC의 _immutable subject_ 형식을 씁니다
  (`gh api repos/POcodingWER/backend-visualized/actions/oidc/customization/sub` → `use_immutable_subject: true`).
  그래서 토큰의 `sub`는 소유자·저장소 ID가 붙은 `repo:POcodingWER@<오너ID>/backend-visualized@<저장소ID>:ref:refs/heads/main` 입니다.
  `workflow_run`과 `workflow_dispatch`(main에서 실행) 모두 이 `sub`로 들어옵니다.
- 워크플로에 `environment:`를 붙이면 `sub`가 `…:environment:<이름>`으로 바뀌어 신뢰 정책과 맞지 않습니다.

**서버 쪽 준비**: `sudo snap services amazon-ssm-agent` (Ubuntu 24.04 AMI 기본 설치), 인스턴스 역할을 붙인 뒤
`sudo snap restart amazon-ssm-agent` → 로그(`/var/log/amazon/ssm/amazon-ssm-agent.log`)에 `Credentials ready`.

**`git reset --hard`**: 서버 checkout은 main의 거울입니다. `deploy/production.env`, `deploy/caddy/upstream.caddy`는 git 미추적이라
영향이 없지만, **서버에서 직접 고친 추적 파일은 다음 배포 때 사라집니다.** 고칠 것은 저장소에 커밋하세요.

### 수동 배포 / 롤백 / env 변경

| 하고 싶은 것                      | 방법                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| main 최신 다시 배포               | Actions → **Deploy** → Run workflow (branch main, ref 비움)                                                   |
| 롤백                              | Run workflow → ref에 예전 main 커밋 SHA → 빌드 없이 그 SHA 이미지로 blue-green 교체 (설정 파일은 main 그대로) |
| 오래 유지할 롤백                  | `git revert <문제 커밋>` → main push (다음 push가 다시 최신을 배포하므로 이게 정석)                           |
| 서버에서 직접 (비상)              | `ssh … 'cd /opt/backend-visualized && ./deploy/deploy.sh <40자 SHA>'`                                         |
| `deploy/production.env` 변경 반영 | `./deploy/deploy.sh current` → 같은 이미지를 다른 색으로 다시 띄워 무중단 반영                                |
| 지금 어느 색/이미지?              | `cat deploy/caddy/upstream.caddy`, `./deploy/compose.sh ps`                                                   |

GHCR 이미지는 서버에 최근 3개만 남깁니다. 그보다 오래된 SHA로 롤백하면 GHCR에서 다시 받습니다 (public이면 문제없음).
이 방식(GHCR 이미지) 이전 커밋에는 이미지가 없으므로 그 커밋으로는 롤백할 수 없습니다.

---

## 7-2. DB 백업과 복원 (mysqldump + cron + S3)

같은 EC2의 MySQL 컨테이너를 쓰기 때문에(3장), **디스크가 망가지거나 실수로 지우면 데이터가 같이 사라집니다.** 그래서 매일 백업하고, 그 백업이 정말 복원되는지도 확인합니다.

| 파일                                    | 하는 일                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `deploy/backup-mysql.sh`                | mysql 컨테이너 안에서 `mysqldump` → gzip → `backups/<db>-YYYYMMDD-HHMMSS-KST.sql.gz` (600)     |
| `deploy/restore-test.sh`                | 최신 백업을 임시 DB `backend_visualized_restore_test`에 복원 → 테이블별 `COUNT(*)` 비교 → DROP |
| `deploy/cron/backend-visualized-backup` | `/etc/cron.d`에 들어갈 cron 파일: **매일 04:00 KST**, ubuntu 사용자                            |
| `deploy/install-backup-cron.sh`         | 위 cron 파일을 설치/갱신 (몇 번 실행해도 같음). `deploy.sh`가 배포 때마다 부름                 |

```
04:00 KST cron ─▶ backup-mysql.sh
                   │ docker compose exec mysql  mysqldump --single-transaction --routines --triggers --events
                   ▼ (컨테이너 밖에서) nice/ionice gzip
            backups/backend_visualized-20261021-093620-KST.sql.gz  (chmod 600, 폴더 700)
                   │ 7일 지난 파일 삭제
                   └─▶ (BACKUP_S3_BUCKET 있으면) aws s3 cp → s3://<버킷>/mysql/
```

- **잠금 없음**: InnoDB라 `--single-transaction`이면 테이블을 잠그지 않고 한 시점의 스냅샷을 뜹니다. 백업 중에도 API는 그대로 동작합니다.
- **비밀번호 노출 없음**: `MYSQL_ROOT_PASSWORD`는 **컨테이너 안의 환경 변수**를 그 안에서 `MYSQL_PWD`로 넘깁니다. 서버 셸, `ps`, 로그에 값이 나오지 않습니다. `production.env`도 필요한 키만 `sed`로 읽고 통째로 `source`하지 않습니다.
- **2GB 서버 부담**: `mysqldump`는 `nice -n 19`, gzip은 `nice`+`ionice -c3`(유휴 I/O). 현재 DB(0.5MB)는 0.4초, 메모리 28MB 정도입니다.
- **반쯤 쓰인 백업 방지**: `.partial`로 쓰고 `gzip -t` + 마지막 줄 `-- Dump completed`를 확인한 뒤에만 이름을 바꿉니다. 겹쳐 실행되면 `flock`으로 막습니다.
- **다른 이름으로 복원 가능**: `--databases`를 안 써서 덤프에 `CREATE DATABASE`/`USE`가 없습니다.
- **백업 파일도 민감 정보**: 비밀번호 해시(`passwordHash`), refresh 토큰 기록이 들어 있으므로 600 권한이고 git에는 안 올라갑니다(`backups/`는 .gitignore).
- **시간대**: cron은 서버 시간대를 따릅니다. 서버가 `Asia/Seoul`이라 `0 4 * * *` = 04:00 KST (`timedatectl`로 확인, 아니면 설치 스크립트가 경고).

### 명령 모음 (서버에서, `/opt/backend-visualized`)

```bash
./deploy/install-backup-cron.sh        # cron 설치 (배포 때 자동으로도 실행됨)
./deploy/backup-mysql.sh               # 지금 바로 백업
tail -n 20 backups/backup.log          # cron 실행 기록 (성공/실패, 크기, 걸린 시간)
journalctl -t backend-visualized-backup --since today   # syslog에도 OK / FAILED 한 줄씩
ls -lh backups/
./deploy/restore-test.sh               # 최신 백업 복원 테스트 (운영 DB는 안 건드림)
```

`restore-test.sh`는 백업 **이후** 운영 DB에 쓰기가 있으면 그 테이블 숫자가 달라 `RESTORE_TEST=DIFF`가 나올 수 있습니다(데모 쿠폰 발급 등). 백업 직후 바로 돌리면 일치해야 합니다.

### 진짜로 복원해야 할 때 (운영 DB 덮어쓰기)

덤프에는 `DROP TABLE IF EXISTS`가 들어 있어 **기존 테이블을 덮어씁니다.** 되돌릴 수 있게 지금 상태부터 백업하세요.

```bash
cd /opt/backend-visualized
./deploy/backup-mysql.sh                                   # 1) 지금 상태도 한 부
./deploy/compose.sh stop api_blue_1 api_blue_2 api_green_1 api_green_2   # 2) 쓰기 멈춤 (잠깐 502)
zcat backups/backend_visualized-<시각>-KST.sql.gz \
  | ./deploy/compose.sh exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot backend_visualized'
./deploy/deploy.sh current                                 # 3) API 다시 띄우기 (blue-green)
```

S3에서 받을 때: `aws s3 cp s3://<버킷>/mysql/<파일> backups/` (이 경우 역할에 `s3:GetObject`가 필요하므로 콘솔에서 받거나 로컬 PC 자격 증명으로 받는 것을 권장).

### 서버 밖 S3에 한 부 더: 콘솔에서 1회 (2026-10-21 설정 완료)

서버 디스크에만 있으면 EC2를 잃을 때 백업도 같이 잃습니다. S3 업로드는 스크립트에 이미 들어 있고 **`BACKUP_S3_BUCKET`을 넣을 때만** 동작합니다.

1. **S3 → 버킷 만들기**: 이름 `backend-visualized-db-backups` (실제로 만든 버킷), 리전 **아시아 태평양(서울) ap-northeast-2**
   - 모든 퍼블릭 액세스 차단: **켜기**(기본값) / 버킷 버전 관리: **활성화** / 기본 암호화: **SSE-S3**(기본값)
2. **버킷 → 관리 → 수명 주기 규칙 만들기**: 이름 `expire-mysql-backups`, 접두사 `mysql/`
   - 객체의 현재 버전 만료: **30일** / 객체의 이전 버전 영구 삭제: **7일** / 불완전한 멀티파트 업로드 삭제: **1일**
3. **IAM → 역할 → `backend-visualized-ec2-ssm` → 권한 추가 → 인라인 정책 생성 → JSON**, 이름 `s3-backup-put-only`

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PutMysqlBackupsOnly",
         "Effect": "Allow",
         "Action": "s3:PutObject",
         "Resource": "arn:aws:s3:::backend-visualized-db-backups/mysql/*"
       }
     ]
   }
   ```

   **쓰기만** 허용합니다. 서버가 털려도 S3의 백업을 읽거나 지울 수 없고, 같은 이름으로 덮어써도 버전 관리가 예전 버전을 남깁니다.

4. **서버**: `deploy/production.env`에 한 줄 추가 → 바로 확인

   ```bash
   echo 'BACKUP_S3_BUCKET=backend-visualized-db-backups' >> deploy/production.env
   aws --version || sudo snap install aws-cli --classic
   ./deploy/backup-mysql.sh     # 마지막에 "S3 업로드: s3://…" 가 나오면 성공
   aws s3api head-object --bucket backend-visualized-db-backups --key mysql/<파일>   # 403이 정상 (쓰기 전용 역할)
   ```

   (API 컨테이너에는 이 값이 쓰이지 않으므로 다시 띄울 필요 없음)

---

## 7-3. 장애 알아채기 (로그 · 오류 알림 · 살아 있는지 감시)

| 무엇           | 어디서                               | 하는 일                                                                                                    |
| -------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 요청 로그      | `src/common/observability/logger.ts` | 운영은 한 줄 JSON(pino). 요청마다 `x-request-id` (들어온 값이 안전하면 이어 받음). `/health`는 로그에서 뺌 |
| 오류 응답 모양 | `all-exceptions.filter.ts`           | 모든 오류를 `{ statusCode, message, requestId, … }`로. 500은 내부 메시지를 숨기고 로그 + Sentry            |
| Sentry (선택)  | `sentry.ts`, `SENTRY_DSN`            | DSN이 있을 때만 켬. 오류만 전송(트레이스 0), 태그 `request_id`                                             |
| 살아 있는지    | `.github/workflows/uptime.yml`       | 15분마다 `/health`, 20초 간격 3번 연속 실패면 job 실패 → GitHub이 메일                                     |

```bash
# 화면에서 오류가 났을 때: 응답 헤더의 x-request-id로 서버 로그 찾기
./deploy/compose.sh logs api_blue_1 api_blue_2 api_green_1 api_green_2 | grep '<request-id>'

# Sentry 켜기: production.env에 SENTRY_DSN=... 한 줄 → 다시 배포 (Actions → Deploy → Run workflow)
./deploy/compose.sh logs api_blue_1 | grep 'sentry='   # [config] … sentry=on
```

한계: 15분 간격이라 짧은 장애는 놓칠 수 있고, GitHub 예약 실행은 몇 분 늦거나 저장소가 60일 조용하면 꺼진다. 알림은 메일뿐 (메신저·1분 단위 외부 감시는 아직 없음).

---

## 7-4. 부하 테스트 (k6, 2026-10-21)

```bash
# 내 맥에서 (서버에서 돌리지 않는다: 같은 CPU를 나눠 쓰면 결과가 틀어짐). <API_HOST>는 실제 주소로
brew install k6
k6 run -e API_URL=https://<API_HOST> --summary-export=/tmp/k6-summary.json --out csv=/tmp/k6.csv load/breakpoint.js
```

- 읽기만 부른다 (`/health`, `/events/stats`) → 끝나도 DB에 남는 데이터 없음. IP별 한도(429)가 걸린 엔드포인트는 뺐다 (내 맥 한 대에서 보내면 한도에 먼저 막힘)
- 단계: 10 → 50 → 100 → 200 → 400 → 800 VU, 실패율 50%가 30초 넘으면 스스로 중단

| VU  | 처리량 (req/s) | p50       | p95      | 실패                       |
| --- | -------------- | --------- | -------- | -------------------------- |
| 10  | 약 164         | 13ms      | 90ms     | 0                          |
| 50  | 약 530~545     | 41ms      | 약 120ms | 0                          |
| 100 | 약 600~620     | 76ms      | 약 460ms | 0                          |
| 200 | 약 620~630     | 약 88ms   | 약 1.3초 | 0                          |
| 400 | 약 635         | 약 90ms   | 약 3.1초 | 0                          |
| 800 | 약 645~655     | 190~350ms | 7~10초   | 4~6% (전부 10초 시간 초과) |

전체: 12분, 389,658 요청, 평균 541 req/s, 실패 0.89%, 중앙값 86ms, p95 2.64초, p99 7.22초, 최대 10초. 테스트 뒤 재시작 0번, `OOMKilled` 없음, MySQL `Max_used_connections` 14, `Slow_queries` 0, Redis `rejected_connections` 0, `/health` 200.

**원인**: 처리량이 100 VU부터 약 620 req/s에서 멈추고 기다리는 시간만 늘었다. 그동안 API 컨테이너 CPU는 100~120% (2코어라 최대 200%). Node는 요청을 이벤트 루프 하나에서 처리해서, 코어 하나가 꽉 차면 그 뒤 요청은 줄을 선다. 메모리·DB·Redis는 여유가 있었다.

**그다음 (7장에서 함)**: API 복제본 2개 + Caddy `least_conn` 분산으로 코어 2개를 씁니다. 프로세스 메모리에 있던 "한 번에 하나"·쿨다운, cron 잠금, SSE 알림은 Redis로 옮겼습니다. 아직 안 한 것: 전역·IP별 한도(throttler)는 인스턴스별로 남아 있고, `/events/stats` 같은 무거운 읽기의 짧은 캐시도 아직입니다. 늘린 뒤 수치는 아래 7-5.

## 7-5. 재측정 (API 2개, 2026-10-22)

7-4와 같은 스크립트, 같은 맥, 같은 단계. 서버에서는 `diagnose.sh watch`가 약 36초마다 `free`·`docker stats`를 남겼다.

| VU  | 처리량 (req/s) | p50     | p95     | 실패 | 1개일 때 p95 |
| --- | -------------- | ------- | ------- | ---- | ------------ |
| 10  | 약 167         | 12ms    | 86ms    | 0    | 90ms         |
| 50  | 약 533         | 39ms    | 130ms   | 0    | 약 120ms     |
| 100 | 약 621         | 112ms   | 227ms   | 0    | 약 460ms     |
| 200 | 약 641         | 253ms   | 476ms   | 0    | 약 1.3초     |
| 400 | 약 651         | 549ms   | 953ms   | 0    | 약 3.1초     |
| 800 | 약 639         | 1.18초  | 1.88초  | 0    | 7~10초       |

전체: 12분, 395,841 요청, 평균 550 req/s, 실패 0%, 중앙값 253ms, p95 1.4초, p99 1.85초, 최대 3.6초. 재시작 0번, 메모리 최고 1133MB (가용 최저 703MB), load 최고 약 15.

정점 구간(12:01~12:09 KST) `docker stats` CPU (100% = 코어 1개):

| 컨테이너   | CPU            |
| ---------- | -------------- |
| api_blue_1 | 약 50~65%      |
| api_blue_2 | 약 45~60% (가끔 75~90%) |
| caddy      | 약 35~50%      |
| mysql      | 약 25~40%      |
| redis      | 1% 아래        |

**결과**: 처리량은 약 620 → 640 req/s로 거의 그대로. 대신 줄이 두 갈래로 나뉘어 p95와 시간 초과가 줄었다. 중앙값은 오히려 올랐는데(800 VU 190~350ms → 1.18초), 추정으로는 1개일 때 늦은 요청이 10초 시간 초과로 빠져 나머지가 빨라 보였고, 2개일 때는 실패 없이 모두가 고르게 조금씩 기다린 결과다 (따로 확인하진 않았다).

**다음 병목**: 컨테이너 CPU 합이 측정마다 약 175~190%로 2코어(200%)가 거의 다 찼다. API 하나는 반 코어 남짓만 쓰고, 나머지 약 40%를 Caddy(TLS + 프록시)와 MySQL(`/events/stats`의 COUNT + GROUP BY)이 가져갔다. 그래서 같은 서버에서 API를 더 켜도 늘 것이 없다. 다음 손잡이는 `/events/stats` 짧은 캐시(MySQL 몫 줄이기), Caddy · DB를 다른 서버로 빼기, 또는 인스턴스 키우기.


서버 쪽 기록: `deploy/diagnose.sh` (`snapshot` · `watch` · `report` · `recover`). 배포 끝에 `deploy.sh`가 지난 30분 기록을 요약하고 새 `watch 1800`을 시작한다. Actions의 **Diagnose** workflow(손으로 실행)로도 돌릴 수 있다. 이번 테스트 때는 `watch`가 `local` 한 줄 계산 버그로 바로 끝나서 5초 간격 기록이 없었고(고침), CPU는 서버에서 직접 본 `docker stats` 값이다.

---

## 8. 문제 해결

| 증상                                                                                        | 확인                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| API 컨테이너가 바로 종료                                                                    | `./deploy/compose.sh logs api_blue_1`(또는 `api_green_1`) 의 `[config] 환경 변수 설정 오류` 목록                                              |
| 인증서 발급 실패                                                                            | DNS A 레코드가 Elastic IP인지, 보안 그룹 80/443 열림 확인. `logs caddy`                                                                       |
| 브라우저 CORS 오류                                                                          | `WEB_ORIGIN`이 Vercel 주소와 **정확히** 같은지 (https, 끝 슬래시 없음)                                                                        |
| 새로고침하면 로그아웃                                                                       | 4장: `none`+Secure+Partitioned인지. 엄격한 쿠키 설정·오래된 브라우저면 커스텀 도메인 + `lax`                                                  |
| 모든 사용자가 429                                                                           | `TRUST_PROXY` 값 (Caddy 뒤면 1)                                                                                                               |
| `prisma migrate deploy` 반복 실패                                                           | RDS 보안 그룹이 EC2 보안 그룹을 허용하는지, 비밀번호 URL 인코딩                                                                               |
| Deploy: `Could not assume role` / `Not authorized to perform sts:AssumeRoleWithWebIdentity` | 신뢰 정책의 `sub`가 immutable 형식(`repo:POcodingWER@<오너ID>/backend-visualized@<저장소ID>:ref:refs/heads/main`)인지, `aud`, OIDC 공급자 ARN |
| Deploy: `InvalidInstanceId`                                                                 | 인스턴스에 `backend-visualized-ec2-ssm` 역할이 붙었는지, SSM Agent 재시작 후 Fleet Manager에 Online인지                                       |
| Deploy: `AccessDeniedException ... ssm:SendCommand`                                         | 배포 역할 인라인 정책의 인스턴스 ARN·문서 ARN(`arn:aws:ssm:ap-northeast-2::document/AWS-RunShellScript`)                                      |
| Deploy: `FALLBACK_LOCAL_BUILD` 경고, 배포가 느림                                            | GHCR 패키지가 private → 7-1장 「GHCR 패키지 공개 여부」                                                                                       |
| Deploy: `api_<색> 가 건강해지지 않았습니다`                                                 | 출력에 붙은 새 컨테이너 로그 (마이그레이션 오류, `[config]` env 오류). 서비스는 예전 색이 계속 함                                             |
| 502가 계속 남                                                                               | `cat deploy/caddy/upstream.caddy`의 색이 실제로 떠 있는지 `./deploy/compose.sh ps`. 아니면 `./deploy/deploy.sh current`                       |
| Deploy: `caddy reload` 가 `localhost:2019 ... connection refused`                           | caddy가 막 다시 만들어져 관리 API가 아직 안 뜬 상태. deploy.sh가 15초까지 다시 시도함. 그래도 실패하면 `./deploy/deploy.sh current`           |
| `backups/backup.log`에 `실패:`                                                              | `mysqldump 오류`면 `./deploy/compose.sh ps mysql`(healthy?), `S3 업로드 실패`면 역할의 `s3:PutObject`와 버킷 이름                             |
| 04:00에 백업이 안 생김                                                                      | `cat /etc/cron.d/backend-visualized-backup`, `timedatectl`(Asia/Seoul?), `grep CRON /var/log/syslog`                                          |
