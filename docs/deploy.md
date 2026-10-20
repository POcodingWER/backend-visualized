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

| #   | 항목                                                                                                        | 용도                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | **AWS 계정** (EC2·RDS·Elastic IP를 만들 수 있는 IAM 사용자 또는 콘솔 접근)                                  | 서버·DB                                                                                           |
| 2   | **리전 선택** (권장: 서울 `ap-northeast-2`)                                                                 | 지연 시간                                                                                         |
| 3   | **API 도메인** 1개 (예: `api.example.com`)와 그 DNS를 수정할 수 있는 권한 (가비아, Route 53, Cloudflare 등) | HTTPS 인증서는 도메인이 있어야 발급됩니다. IP만으로는 HTTPS 불가 → 브라우저가 Secure 쿠키를 못 씀 |
| 4   | **Vercel 계정** + 이 GitHub 저장소 접근 연결                                                                | 웹 배포                                                                                           |
| 5   | DB 방식 선택: **RDS** 또는 **EC2 안의 MySQL 컨테이너**                                                      | 비용/관리 트레이드오프 (아래 3장)                                                                 |
| 6   | (선택) 웹 커스텀 도메인 (예: `app.example.com`)                                                             | 쿠키를 같은 사이트로 만들어 Safari 등에서도 로그인 유지가 확실해짐 (4장)                          |
| 7   | Let's Encrypt 알림용 이메일 (`ACME_EMAIL`)                                                                  | 인증서 만료 경고 수신                                                                             |

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

업데이트: `git pull && ./deploy/compose.sh up -d --build` (마이그레이션은 컨테이너 시작 시 자동 적용).

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
| `COUPON_SIMULATION_COOLDOWN_MS`                                         |       —       | `3000`                            | 쿠폰 시뮬레이션 종료 후 전역 쿨다운                                                               |
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

## 8. 문제 해결

| 증상                              | 확인                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| API 컨테이너가 바로 종료          | `./deploy/compose.sh logs api` 의 `[config] 환경 변수 설정 오류` 목록   |
| 인증서 발급 실패                  | DNS A 레코드가 Elastic IP인지, 보안 그룹 80/443 열림 확인. `logs caddy` |
| 브라우저 CORS 오류                | `WEB_ORIGIN`이 Vercel 주소와 **정확히** 같은지 (https, 끝 슬래시 없음)  |
| 새로고침하면 로그아웃             | 4장: `none`+Secure인지, Safari면 커스텀 도메인 + `lax`                  |
| 모든 사용자가 429                 | `TRUST_PROXY` 값 (Caddy 뒤면 1)                                         |
| `prisma migrate deploy` 반복 실패 | RDS 보안 그룹이 EC2 보안 그룹을 허용하는지, 비밀번호 URL 인코딩         |
