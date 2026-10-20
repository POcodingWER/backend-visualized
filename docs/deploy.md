# 배포 가이드 — 웹은 Vercel, API는 AWS EC2(Docker), DB는 RDS 또는 같은 EC2의 MySQL

```
브라우저 ──HTTPS──▶ Vercel (apps/web, Next.js)
   │
   └──HTTPS (fetch, credentials: include)──▶ EC2 :443 Caddy ──▶ api:4000 (NestJS, Docker)
                                                                  │
                                              RDS MySQL  또는  같은 EC2의 mysql 컨테이너
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
| 6   | (선택) 웹 커스텀 도메인 (예: `app.example.com`)                                                             | 쿠키를 같은 사이트로 만들어 Safari 등에서도 로그인 유지가 확실해짐 (4장)                                               |
| 7   | Let's Encrypt 알림용 이메일 (`ACME_EMAIL`)                                                                  | 인증서 만료 경고 수신                                                                                                  |

비밀값(`JWT_ACCESS_SECRET`, `ADMIN_API_KEY`, DB 비밀번호)은 EC2에서 직접 생성하면 되므로 따로 전달하지 않아도 됩니다.

---

## 1. EC2 만들기

1. **인스턴스 유형**: `t4g.small` (ARM, 2 vCPU / 2 GiB) 권장. x86이 필요하면 `t3.small`.
   - MySQL 컨테이너까지 같이 돌리면 `t4g.small`(2 GiB)에서 동작하도록 MySQL 메모리를 줄여 두었습니다(`innodb-buffer-pool-size=256M`). 여유가 필요하면 `t4g.medium`.
   - `t4g.micro`(1 GiB)는 Docker 이미지 빌드(pnpm install + tsc) 중 메모리가 부족할 수 있습니다 — 쓰려면 스왑 2 GB 추가 필수.
2. **AMI**: Amazon Linux 2023 (ARM64 / t4g면 arm64 선택).
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

### EC2에 Docker 설치 (Amazon Linux 2023)

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
#   API_DOMAIN=3-35-59-193.sslip.io        (IP의 점을 -로: 도메인이 생기면 이 줄만 교체)
#   WEB_ORIGIN=http://localhost:3000   VERCEL_ORIGIN=   (Vercel 주소가 생기면 채우기)
#   MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)   MYSQL_PASSWORD=$(openssl rand -hex 24)
#   DATABASE_URL=mysql://app:<MYSQL_PASSWORD>@mysql:3306/backend_visualized
#   JWT_ACCESS_SECRET=$(openssl rand -base64 48)  ADMIN_API_KEY=$(openssl rand -hex 32)
vi deploy/production.env
chmod 600 deploy/production.env
```

빌드·실행 (t4g.small + 스왑 2GB에서 서버 빌드 약 2분, OOM 없음):

```bash
./deploy/compose.sh up -d --build        # COMPOSE_PROFILES=local-db 라 mysql도 같이 뜸
./deploy/compose.sh ps                   # api/mysql/redis (healthy), 공개 포트는 caddy 80/443 뿐
./deploy/compose.sh logs caddy | grep 'certificate obtained'
curl https://3-35-59-193.sslip.io/health # {"status":"ok","db":{"status":"up",...}}
```

> **도메인 없이 HTTPS**: [sslip.io](https://sslip.io)는 `3-35-59-193.sslip.io` → `3.35.59.193`으로 응답하는 공개 DNS라
> Caddy가 Let's Encrypt 인증서를 바로 받습니다. 현재 서버에는 Elastic IP `3.35.59.193`이 연결돼 있습니다 (2026-10-20). Elastic IP가 없으면 인스턴스를 **중지/시작**할 때 공인 IP가 바뀌므로
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
./deploy/compose.sh up -d --build
# 또는 같은 EC2의 MySQL 컨테이너 사용 (DATABASE_URL 호스트를 mysql 로)
./deploy/compose.sh --profile local-db up -d --build

./deploy/compose.sh ps            # api가 (healthy) 인지 확인
./deploy/compose.sh logs -f api   # [config] 요약 줄과 경고 확인
curl https://api.example.com/health
```

업데이트: main에 push하면 CI 성공 후 **자동 배포**됩니다 (7-1장). 수동으로 하려면 `git pull && ./deploy/compose.sh up -d --build` (마이그레이션은 컨테이너 시작 시 자동 적용).

CORS 출처 추가 (예: Vercel 배포 후): `deploy/production.env`의 `VERCEL_ORIGIN=https://<앱>.vercel.app` → `./deploy/compose.sh up -d`.
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
ssh -i ~/.ssh/backend-visualized.pem -N -L 13306:127.0.0.1:3306 ubuntu@3.35.59.193
```

또는 Workbench 내장 터널: Connection Method **Standard TCP/IP over SSH**

| 항목              | 값                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------- |
| SSH Hostname      | `3.35.59.193:22`                                                                             |
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
5. Deploy → 나온 주소(예: `https://backend-visualized.vercel.app`)를 EC2의 `WEB_ORIGIN`에 넣고 `./deploy/compose.sh up -d` 로 API 재시작.

> Preview 배포 주소(`…-git-branch-….vercel.app`)는 매번 달라서 CORS에 막힙니다. 필요하면 그 주소를 `WEB_ORIGIN`에 쉼표로 추가하세요.

### 리프레시 쿠키와 "사이트" — 꼭 읽어주세요

브라우저는 **등록 가능한 도메인(eTLD+1)** 이 같으면 같은 사이트로 봅니다. `vercel.app`은 공개 접미사라
`my-app.vercel.app`과 `api.example.com`은 **서로 다른 사이트**입니다.

| 구성                                                        | 사이트 관계             | 쿠키 설정 (`REFRESH_COOKIE_SAME_SITE`)        |
| ----------------------------------------------------------- | ----------------------- | --------------------------------------------- |
| 로컬 `localhost:3000` ↔ `localhost:4000`                    | 같은 사이트 (포트 무관) | `lax` (개발 기본값)                           |
| `my-app.vercel.app` ↔ `api.example.com`                     | **다른 사이트**         | `none` + Secure (+ Partitioned) — 운영 기본값 |
| `app.example.com`(Vercel 커스텀 도메인) ↔ `api.example.com` | 같은 사이트             | `lax` **권장**                                |

- `none`이면 쿠키가 "서드파티 쿠키"가 됩니다. 이 API는 `Partitioned`(CHIPS) 속성을 붙여 Chrome 계열에서 서드파티 쿠키 제한이 있어도 동작하게 했지만, **Safari 등 서드파티 쿠키를 막는 브라우저에서는 새로고침 후 로그인 복구가 실패할 수 있습니다** (로그인 직후 동작은 액세스 토큰이 메모리에 있어 정상).
- 확실하게 하려면 웹에 커스텀 도메인(`app.example.com`)을 연결하고 `REFRESH_COOKIE_SAME_SITE=lax`로 바꾸세요. Vercel → Project → Settings → Domains에서 추가하고 안내대로 DNS(CNAME)를 설정하면 됩니다.

---

## 5. 환경 변수 표 (API, `deploy/production.env`)

| 변수                                                                    |   운영 필수   | 기본값 (개발 / 운영)              | 설명                                                                                              |
| ----------------------------------------------------------------------- | :-----------: | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                          |      ✅       | —                                 | `mysql://user:password@host:3306/backend_visualized`                                              |
| `REDIS_URL`                                                             |      ✅       | `redis://127.0.0.1:6380/0` / 없음 | 6장 캐시. `redis://` 또는 `rediss://`. compose 안이면 `redis://redis:6379/0`                      |
| `WEB_ORIGIN`                                                            |      ✅       | `http://localhost:3000` / 없음    | CORS 허용 출처. 경로 없이, 쉼표로 여러 개. 운영은 https, `*` 금지                                 |
| `VERCEL_ORIGIN`                                                         |       —       | 없음                              | compose가 `WEB_ORIGIN` 뒤에 쉼표로 붙임 (Vercel 주소용 자리)                                      |
| `COMPOSE_PROFILES`                                                      |       —       | 없음                              | `local-db`면 `--profile local-db` 없이 mysql 컨테이너도 같이 실행                                 |
| `JWT_ACCESS_SECRET`                                                     |      ✅       | 개발용 공개값 / 없음              | 32자 이상, 저장소에 적힌 기본값 금지. `openssl rand -base64 48`                                   |
| `API_DOMAIN`                                                            |  ✅ (Caddy)   | —                                 | Caddy가 HTTPS 인증서를 받을 도메인                                                                |
| `ACME_EMAIL`                                                            |  ✅ (Caddy)   | —                                 | Let's Encrypt 인증서 알림 메일                                                                    |
| `ADMIN_API_KEY`                                                         |     선택      | 없음                              | `/events/admin/*` 호출 시 `X-Admin-Api-Key` 헤더. 없으면 개발=허용, 운영=비활성. 운영은 24자 이상 |
| `TRUST_PROXY`                                                           |       —       | `false` / compose에서 `1`         | 프록시 홉 수 또는 IP/CIDR. Caddy 뒤=1, ALB+Caddy=2. `true`는 운영에서 금지(IP 위조)               |
| `REFRESH_COOKIE_SAME_SITE`                                              |       —       | `lax` / `none`                    | 4장 참고                                                                                          |
| `REFRESH_COOKIE_SECURE`                                                 |       —       | `false` / `true`                  | `none`이면 반드시 `true`                                                                          |
| `REFRESH_COOKIE_PARTITIONED`                                            |       —       | SameSite=None이면 `true`          | CHIPS 파티션 쿠키                                                                                 |
| `AUTH_DEMO_ENDPOINTS`                                                   |       —       | `true` / `false`                  | 토큰 탈취 시뮬레이션 등 데모 전용 API. 공개 데모 사이트라면 `true`로 명시                         |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`                                         |       —       | `20`                              | 액세스 토큰 수명 (데모라 짧음)                                                                    |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS`                                        |       —       | `86400`                           | 리프레시 토큰/쿠키 수명                                                                           |
| `MAX_BODY_SIZE`                                                         |       —       | `200kb`                           | JSON/text 요청 본문 최대 크기 (초과 시 413)                                                       |
| `EVENTS_GLOBAL_LIMIT_PER_MINUTE`                                        |       —       | `30000`                           | 서버 전체 분당 저장 이벤트 수 (0=무제한)                                                          |
| `RATE_LIMIT_DEMO_GLOBAL_LIMIT_PER_MINUTE`                               |       —       | `20000`                           | 레이트 리밋 체험 엔드포인트 전역 분당 한도                                                        |
| `MAX_STREAM_CONNECTIONS`                                                |       —       | `200`                             | 동시 SSE(`/events/stream`) 연결 수                                                                |
| `AGGREGATION_DEMO_COOLDOWN_MS`                                          |       —       | `10000`                           | 공개 "지금 집계 실행" 버튼 전역 쿨다운                                                            |
| `SIMULATION_COOLDOWN_MS`                                                |       —       | `3000`                            | 1·4·6장 시뮬레이션 종료 후 전역 쿨다운 (ms)                                                       |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT`                                    |       —       | `10000` / `200`                   | IP별 기본 한도 (라우트별 `@Throttle`이 우선)                                                      |
| `RUN_MIGRATIONS`                                                        |       —       | `true`                            | 컨테이너 시작 시 `prisma migrate deploy` 실행 여부                                                |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `MYSQL_USER`, `MYSQL_DATABASE` | local-db일 때 | —                                 | MySQL 컨테이너 초기화용                                                                           |

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

- 전역 한도·IP별 한도는 **API 인스턴스 메모리**에 있습니다. 인스턴스를 여러 대로 늘리면 이미 있는 Redis로 옮겨야 합니다 (6장 캐시만 Redis를 씀).
- IP별 한도는 `req.ip` 기준이라 `TRUST_PROXY`가 맞아야 합니다. 틀리면 모든 사용자가 Caddy IP 하나로 묶여 서로의 한도를 나눠 씁니다.

---

## 7. CI (GitHub Actions)

`.github/workflows/ci.yml` — PR과 main push마다:

1. MySQL 8.4 + Redis 7.4 서비스 컨테이너 → `prisma migrate deploy`
2. `pnpm format:check` → `pnpm typecheck` → `pnpm lint` → `pnpm test` (DB 통합 테스트 포함, `REQUIRE_DATABASE=true`라 DB가 없으면 실패) → `pnpm build`
3. 운영 모드로 API 실행 후 `/health`, 관리자 키 401/201 스모크 테스트
4. API Docker 이미지 빌드 확인 (push 안 함)

---

## 7-1. 자동 배포 (CD): GitHub Actions → OIDC → SSM → EC2

`.github/workflows/deploy.yml` — main에 push하고 CI가 **성공**하면 자동으로 EC2에 배포합니다.

```
git push origin main
   │
   ▼
CI (ci.yml: typecheck · lint · test · build · Docker 이미지 빌드)
   │  성공 (workflow_run 이벤트, conclusion=success, event=push)
   ▼
Deploy (deploy.yml)
   ├─ 1) GitHub OIDC 토큰 ──▶ AWS STS AssumeRoleWithWebIdentity
   │        role: backend-visualized-github-deploy (1시간짜리 임시 자격 증명)
   ├─ 2) aws ssm send-command (AWS-RunShellScript, 인스턴스 i-0c7a663e814fc808d)
   │        │
   │        ▼   EC2의 SSM Agent가 AWS로 "바깥으로" 연결해 명령을 받아 실행 (root → sudo -u ubuntu)
   │      cd /opt/backend-visualized
   │      git fetch origin main && git reset --hard <CI가 검사한 SHA>
   │      ./deploy/compose.sh up -d --build && docker image prune -f
   ├─ 3) get-command-invocation 폴링 (Success가 아니면 job 실패, 서버 stdout/stderr 출력)
   └─ 4) curl https://3-35-59-193.sslip.io/health 가 200일 때까지 재시도 (아니면 실패)
```

**왜 SSH가 아니라 SSM?**

- SSH로 배포하려면 GitHub Actions 러너(IP가 매번 바뀜)에게 22번 포트를 열어야 하고, 개인키를 GitHub Secret에 넣어야 합니다.
- SSM은 EC2의 에이전트가 AWS로 **나가는(outbound)** 연결만 쓰므로 인바운드 포트를 하나도 더 열 필요가 없고,
  누가 어떤 명령을 보냈는지 CloudTrail/SSM 기록에 남습니다.
- OIDC 덕분에 AWS Access Key 같은 장기 비밀값을 GitHub에 저장하지 않습니다. 토큰은 "이 저장소의 main 브랜치에서 돈 워크플로"만 받을 수 있습니다.

**AWS 쪽 구성 (콘솔에서 1회, 최소 권한)**

| 구성 요소                                      | 내용                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| EC2 인스턴스 역할 `backend-visualized-ec2-ssm` | 관리형 정책 `AmazonSSMManagedInstanceCore`만. SSM Agent가 AWS에 등록되는 데 필요                                                            |
| IAM OIDC 공급자                                | `token.actions.githubusercontent.com`, audience `sts.amazonaws.com`                                                                         |
| 배포 역할 `backend-visualized-github-deploy`   | 신뢰 정책: `aud` = `sts.amazonaws.com`, `sub` = `repo:POcodingWER@89626659/backend-visualized@1425018571:ref:refs/heads/main` (아래 주의)   |
| 배포 역할 인라인 정책                          | `ssm:SendCommand` → 이 인스턴스 ARN + `AWS-RunShellScript` 문서만 / `ssm:GetCommandInvocation`, `ssm:ListCommandInvocations` → `*` (조회만) |

- **`sub` 형식 주의 (immutable subject)**: 이 저장소는 GitHub OIDC의 _immutable subject_ 형식을 씁니다
  (`gh api repos/POcodingWER/backend-visualized/actions/oidc/customization/sub` → `use_immutable_subject: true`).
  그래서 토큰의 `sub`는 `repo:POcodingWER/backend-visualized:…`가 아니라 **소유자·저장소 ID가 붙은**
  `repo:POcodingWER@89626659/backend-visualized@1425018571:ref:refs/heads/main` 입니다. 신뢰 정책 예:

  ```json
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:POcodingWER@89626659/backend-visualized@1425018571:ref:refs/heads/main"
    }
  }
  ```

  `workflow_run`과 `workflow_dispatch`(main에서 실행) 모두 이 `sub`로 들어옵니다. 저장소 이름이 재사용돼도 다른 사람이 같은 `sub`를 만들 수 없어서 더 안전합니다.

- 배포 역할은 EC2를 만들거나 지우거나, 다른 인스턴스에 명령을 보내거나, 비밀값을 읽을 수 없습니다.
- 워크플로에 `environment:`를 붙이면 OIDC `sub`가 `repo:…:environment:<이름>`으로 바뀌어 신뢰 정책과 맞지 않습니다. 붙이려면 신뢰 정책도 같이 바꾸세요.

**서버 쪽 준비**

```bash
sudo snap services amazon-ssm-agent          # Ubuntu 24.04 AMI에 기본 설치 (enabled/active)
# 인스턴스 역할을 붙인 뒤 에이전트 재시작 → 로그에 등록 성공이 보여야 함
sudo snap restart amazon-ssm-agent
sudo tail -n 30 /var/log/amazon/ssm/amazon-ssm-agent.log   # "Successfully registered" / "credentials" 오류가 없어야 함
```

**`git reset --hard`를 쓰는 이유와 주의점**

서버 checkout은 "main을 그대로 비추는 거울"이어야 합니다. `deploy/production.env`(비밀값)는 `.gitignore` 대상이라
reset의 영향을 받지 않지만, **서버에서 직접 고친 추적 파일은 다음 배포 때 사라집니다.** 고칠 것은 반드시 저장소에 커밋하세요.
(배포 전에 `git status --short`가 비어 있는지 확인해 두었습니다.)

**수동 배포 / 롤백**

- Actions → **Deploy** → Run workflow → `ref` 비우면 main 최신 재배포.
- 롤백: `ref`에 예전 main 커밋 SHA를 넣고 실행 (main에 없는 커밋은 거부). **다음 main push 때 다시 최신으로 배포**되므로,
  오래 유지할 롤백이면 `git revert <문제 커밋>` → main에 push 하는 게 정석입니다.
- DB 마이그레이션은 되돌려지지 않습니다 (Prisma `migrate deploy`는 앞으로만). 스키마를 바꾼 커밋을 롤백할 땐 주의.
- `up -d --build`는 api 컨테이너를 다시 만드는 몇 초 동안 Caddy가 502를 돌려줄 수 있습니다 (단일 인스턴스의 한계).

---

## 8. 문제 해결

| 증상                                                                                        | 확인                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| API 컨테이너가 바로 종료                                                                    | `./deploy/compose.sh logs api` 의 `[config] 환경 변수 설정 오류` 목록                                                                         |
| 인증서 발급 실패                                                                            | DNS A 레코드가 Elastic IP인지, 보안 그룹 80/443 열림 확인. `logs caddy`                                                                       |
| 브라우저 CORS 오류                                                                          | `WEB_ORIGIN`이 Vercel 주소와 **정확히** 같은지 (https, 끝 슬래시 없음)                                                                        |
| 새로고침하면 로그아웃                                                                       | 4장: `none`+Secure인지, Safari면 커스텀 도메인 + `lax`                                                                                        |
| 모든 사용자가 429                                                                           | `TRUST_PROXY` 값 (Caddy 뒤면 1)                                                                                                               |
| `prisma migrate deploy` 반복 실패                                                           | RDS 보안 그룹이 EC2 보안 그룹을 허용하는지, 비밀번호 URL 인코딩                                                                               |
| Deploy: `Could not assume role` / `Not authorized to perform sts:AssumeRoleWithWebIdentity` | 신뢰 정책의 `sub`가 immutable 형식(`repo:POcodingWER@89626659/backend-visualized@1425018571:ref:refs/heads/main`)인지, `aud`, OIDC 공급자 ARN |
| Deploy: `InvalidInstanceId`                                                                 | 인스턴스에 `backend-visualized-ec2-ssm` 역할이 붙었는지, SSM Agent 재시작 후 Fleet Manager에 Online인지                                       |
| Deploy: `AccessDeniedException ... ssm:SendCommand`                                         | 배포 역할 인라인 정책의 인스턴스 ARN·문서 ARN(`arn:aws:ssm:ap-northeast-2::document/AWS-RunShellScript`)                                      |
