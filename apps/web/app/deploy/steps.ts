/**
 * 배포 및 회고 페이지의 "순서대로" 내용. 실제로 친 명령은 ~/Desktop/deploy-commands.log와
 * docs/deploy.md에서 옮겼다. 비밀값(비밀번호·토큰·production.env의 값·개인키 내용)은 절대 넣지 않는다.
 * no-secrets.test.ts가 이 폴더의 파일을 검사한다.
 */

export type Where =
  '브라우저 (AWS 콘솔)' | '내 맥' | '서버 (ubuntu@EC2)' | 'GitHub' | '저장소 파일';

export interface CommandBlock {
  where: Where;
  code: string;
}

export interface DeployStep {
  title: string;
  /** 개발자가 아니어도 읽을 수 있는 한두 줄 */
  plain: string;
  commands: CommandBlock[];
  /** 실행 결과에서 알아둘 것 (짧게) */
  result?: string;
  /** 이 단계의 "왜?" 카드 (content.ts REASONS의 id) */
  reason?: string;
}

export const API_HOST = 'https://3-35-59-193.sslip.io';

export const DEPLOY_STEPS: DeployStep[] = [
  {
    title: 'AWS 가입',
    plain:
      '카드를 등록하고 계정을 만들어요. 처음 만든 계정은 "루트 사용자"라 뭐든 할 수 있어서, 2단계 인증(MFA)을 꼭 켜 두는 게 좋아요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `aws.amazon.com → 계정 만들기 (이메일, 결제 카드, 전화 인증)
로그인 화면에서 "루트 사용자" 선택 → 가입한 이메일로 로그인
오른쪽 위 계정 이름 → 보안 자격 증명 → MFA 할당 (휴대폰 인증 앱)
오른쪽 위 리전 → 아시아 태평양(서울) ap-northeast-2`,
      },
    ],
  },
  {
    title: '비용 알림 두 개',
    plain:
      '서버는 켜 두는 동안 계속 돈이 나가요. 실수로 비싼 걸 켜도 바로 알 수 있게, 1센트라도 나가면 오는 알림과 한 달 $30를 넘을 것 같으면 오는 알림을 만들었어요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `Billing and Cost Management → 예산(Budgets) → 예산 생성
  1) 템플릿 "제로 지출 예산"  → 1센트라도 청구되면 메일
  2) 템플릿 "월별 비용 예산" → 금액 $30 → 실제 85%·100%, 예상 100%일 때 메일`,
      },
    ],
    result: 't4g.small + 디스크 + 고정 IP를 합친 어림값이 월 $21 정도라 $30이면 넘을 일이 없어요.',
  },
  {
    title: 'EC2(서버) 만들기',
    reason: 'ubuntu',
    plain:
      'AWS에서 컴퓨터 한 대를 빌려요. 작고 싼 ARM(Graviton) 컴퓨터, 메모리 2GB짜리예요. 들어갈 열쇠(키 페어)와 문(보안 그룹)도 이때 정해요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `EC2 → 인스턴스 시작 (리전: 서울 ap-northeast-2)
  이름          아무거나 (예: backend-visualized)
  AMI           Ubuntu Server 24.04 LTS, 64비트 (Arm)
  인스턴스 유형 t4g.small  (2 vCPU, 2 GiB, 시간당 $0.0208)
  키 페어       새로 만들기 → backend-visualized.pem 내려받기 (다시 못 받음)
  스토리지      gp3 20 GiB
  보안 그룹     인바운드
                  22  (SSH)       내 IP만
                  80  (HTTP)      0.0.0.0/0, ::/0   ← 인증서 발급 + https로 보내기
                  443 (HTTPS)     0.0.0.0/0, ::/0
                3306(MySQL)·6379(Redis)·4000(API)은 열지 않음`,
      },
    ],
  },
  {
    title: '내 맥에서 SSH로 접속',
    plain:
      '내려받은 열쇠 파일로 서버에 들어가요. 열쇠 파일은 나만 읽을 수 있게 권한을 줄여야 SSH가 받아 줘요.',
    commands: [
      {
        where: '내 맥',
        code: `mv ~/Downloads/backend-visualized.pem ~/.ssh/
chmod 400 ~/.ssh/backend-visualized.pem          # 나만 읽기
ssh -i ~/.ssh/backend-visualized.pem ubuntu@13.209.4.20   # 처음 받은 공인 IP (나중에 고정 IP로 바뀜)
uname -m; lsb_release -ds; free -h; df -h /`,
      },
    ],
    result: 'aarch64 · Ubuntu 24.04.4 LTS · 메모리 1.8Gi · 스왑 0B · 디스크 19G',
  },
  {
    title: '서버 기본 설정: 업데이트 · 스왑 · 시간대 · 자동 보안 패치',
    plain:
      '2GB는 빠듯해서 디스크 2GB를 비상용 메모리(스왑)로 붙였어요. 시계는 한국 시간으로, 보안 패치는 매일 알아서 깔리게 했어요.',
    commands: [
      {
        where: '서버 (ubuntu@EC2)',
        code: String.raw`sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade

sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
echo "vm.swappiness=10" | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -p /etc/sysctl.d/99-swappiness.conf

sudo timedatectl set-timezone Asia/Seoul

sudo apt-get install -y unattended-upgrades
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' \
  | sudo tee /etc/apt/apt.conf.d/20auto-upgrades
swapon --show; free -h`,
      },
    ],
    result: '`/swapfile` 2G · `swappiness` 10 · `Time zone: Asia/Seoul (KST)`',
  },
  {
    title: 'Docker 설치',
    plain:
      'API, MySQL, Redis, Caddy를 전부 컨테이너(상자)로 띄워요. 우분투 기본 패키지는 오래돼서 Docker 공식 저장소에서 받았어요.',
    commands: [
      {
        where: '서버 (ubuntu@EC2)',
        code: String.raw`sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu            # sudo 없이 docker (다시 로그인하면 적용)
sudo systemctl enable --now docker containerd`,
      },
    ],
    result: 'Docker 29.9.1 · Compose v5.6.0 · 부팅하면 Docker가 자동으로 켜짐',
  },
  {
    title: '코드 받기: `/opt/backend-visualized`',
    plain:
      '공개 저장소라 토큰 없이 받을 수 있어요. `/opt`는 따로 설치한 프로그램을 두는 리눅스 관례 자리예요.',
    commands: [
      {
        where: '서버 (ubuntu@EC2)',
        code: `sudo apt-get install -y git
sudo mkdir -p /opt/backend-visualized && sudo chown ubuntu:ubuntu /opt/backend-visualized
git clone https://github.com/POcodingWER/backend-visualized.git /opt/backend-visualized
cd /opt/backend-visualized && git log --oneline -1`,
      },
    ],
  },
  {
    title: '비밀값 파일 만들기: `deploy/production.env`',
    plain:
      'DB 비밀번호와 로그인 서명 키는 서버 안에서 바로 만들어 파일에만 적었어요. 깃에도, 채팅에도, 내 맥에도 남지 않아요. 아래 값 자리는 전부 가렸어요.',
    commands: [
      {
        where: '서버 (ubuntu@EC2)',
        code: `cd /opt/backend-visualized
umask 077                                   # 새 파일은 나만 읽기
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)
MYSQL_PASSWORD=$(openssl rand -hex 24)
JWT_ACCESS_SECRET=$(openssl rand -base64 48)
ADMIN_API_KEY=$(openssl rand -hex 32)
cat > deploy/production.env <<ENV
COMPOSE_PROFILES=local-db
API_DOMAIN=13-209-4-20.sslip.io
ACME_EMAIL=<GitHub noreply 메일>
WEB_ORIGIN=http://localhost:3000
VERCEL_ORIGIN=
MYSQL_ROOT_PASSWORD=<서버에서 생성, 가림>
MYSQL_DATABASE=backend_visualized
MYSQL_USER=app
MYSQL_PASSWORD=<서버에서 생성, 가림>
DATABASE_URL=mysql://app:<가림>@mysql:3306/backend_visualized
MIGRATION_MAX_ATTEMPTS=40
REDIS_URL=redis://redis:6379/0
JWT_ACCESS_SECRET=<서버에서 생성, 가림>
ADMIN_API_KEY=<서버에서 생성, 가림>
REFRESH_COOKIE_SAME_SITE=none
AUTH_DEMO_ENDPOINTS=true
SIMULATION_COOLDOWN_MS=3000
ENV
chmod 600 deploy/production.env
grep -oE "^[A-Z_]+=" deploy/production.env | tr -d "="   # 값 말고 이름만 확인
git status --short --ignored deploy/                     # !! = git이 무시하는 파일`,
      },
    ],
    result:
      '실제 파일에서는 `<가림>` 자리에 `openssl`이 만든 값이 들어가요. 화면에는 "이름"만 찍어서 확인했어요.',
  },
  {
    title: 'MySQL · Redis · API 띄우기 (`docker compose`)',
    reason: 'docker-mysql',
    plain:
      '처음에는 서버가 직접 이미지를 만들었어요(2분). DB와 캐시를 먼저 띄우고, API는 켜지면서 테이블을 만드는 작업(마이그레이션)을 알아서 해요.',
    commands: [
      {
        where: '서버 (ubuntu@EC2)',
        code: `cd /opt/backend-visualized
time docker build -f apps/api/Dockerfile -t backend-visualized-api:latest .   # real 1m59s (지금은 안 씀)
./deploy/compose.sh up -d mysql redis
docker inspect -f '{{.State.Health.Status}}' backend-visualized-mysql-1      # healthy
./deploy/compose.sh exec -T redis redis-cli ping                             # PONG
./deploy/compose.sh up -d api
./deploy/compose.sh logs api | grep -iE 'migrat|config'
sudo ss -tlnp | grep -E ':(3306|6379|4000)\\b' || echo "밖에서 안 보임 OK"`,
      },
    ],
    result:
      '`All migrations have been successfully applied` · `[config] mode=production …` · DB·Redis·API 포트는 서버 밖으로 안 열림',
  },
  {
    title: 'HTTPS: Caddy + sslip.io',
    reason: 'caddy',
    plain:
      '인증서는 도메인에만 발급돼요. sslip.io는 `13-209-4-20.sslip.io`를 `13.209.4.20`으로 알려주는 무료 주소라, 도메인 없이도 진짜 인증서를 받았어요. Caddy가 발급과 갱신을 알아서 해요.',
    commands: [
      {
        where: '서버 (ubuntu@EC2)',
        code: `./deploy/compose.sh up -d caddy
./deploy/compose.sh logs caddy | grep -iE 'certificate|acme'
./deploy/compose.sh ps`,
      },
      {
        where: '내 맥',
        code: `curl -sS https://13-209-4-20.sslip.io/health
curl -sSI http://13-209-4-20.sslip.io/health | head -3        # 308 → https로
curl -sSv https://13-209-4-20.sslip.io/health 2>&1 | grep -E 'subject:|issuer:|expire date'`,
      },
    ],
    result:
      '`certificate obtained successfully` · issuer Let’s Encrypt · `{"status":"ok","db":{"status":"up"}}`',
  },
  {
    title: '꺼졌다 켜져도 살아나는지 (재부팅 테스트)',
    plain: 'AWS가 점검으로 서버를 재부팅해도 사람 손 없이 다시 떠야 해요. 진짜로 껐다 켜 봤어요.',
    commands: [
      {
        where: '서버 (ubuntu@EC2)',
        code: `docker inspect -f '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}}' $(docker ps -q)
systemctl is-enabled docker containerd
sudo systemctl reboot`,
      },
      {
        where: '내 맥',
        code: `while true; do curl -sS -m 5 https://13-209-4-20.sslip.io/health; echo; sleep 5; done`,
      },
    ],
    result: '16:11:08 재부팅 → 16:12:04 다시 200. 약 1분. 넣어 둔 데이터도 그대로였어요.',
  },
  {
    title: 'MySQL Workbench: `127.0.0.1`에만 열고 SSH 터널로',
    plain:
      'DB를 그림으로 보고 싶었지만 3306을 인터넷에 열면 위험해요. 서버 자기 자신(`127.0.0.1`)에만 열고, 이미 있는 SSH 길을 터널로 써서 들어가요.',
    commands: [
      {
        where: '저장소 파일',
        code: `# docker-compose.prod.yml (mysql)
    ports:
      - '127.0.0.1:3306:3306'     # '3306:3306'이면 전 세계 공개라 금지`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `./deploy/compose.sh up -d mysql          # 볼륨은 그대로라 데이터 유지
sudo ss -ltnp | grep 3306                 # LISTEN 127.0.0.1:3306`,
      },
      {
        where: '내 맥',
        code: `ssh -i ~/.ssh/backend-visualized.pem -N -L 13306:127.0.0.1:3306 ubuntu@3.35.59.193
# Workbench: Standard TCP/IP over SSH
#   SSH Hostname 3.35.59.193:22 · SSH Username ubuntu · SSH Key File ~/.ssh/backend-visualized.pem
#   MySQL Hostname 127.0.0.1 · Port 3306 · Username app · 비밀번호는 키체인에만
nc -vz -G 5 3.35.59.193 3306      # 인터넷에서 직접은: Operation timed out (막힘이 정상)`,
      },
    ],
  },
  {
    title: '고정 IP(Elastic IP)로 바꾸고 주소 한 줄 고치기',
    reason: 'eip',
    plain:
      '일반 공인 IP는 서버를 중지했다 켜면 바뀌어요. 그러면 주소도 인증서도 다 다시 해야 해서, 계정에 묶이는 고정 IP를 붙였어요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `EC2 → 탄력적 IP → 할당 → 작업 → 연결 → 인스턴스 backend-visualized
  13.209.4.20 (반납) → 3.35.59.193`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `sed -i 's/^API_DOMAIN=.*/API_DOMAIN=3-35-59-193.sslip.io/' deploy/production.env
./deploy/compose.sh up -d          # Caddy가 새 주소로 인증서를 다시 받음`,
      },
    ],
    result: 'API 주소: `' + API_HOST + '`',
  },
  {
    title: 'SSM Agent + 서버용 IAM 역할',
    reason: 'ssm',
    plain:
      '자동 배포는 GitHub가 SSH로 들어오는 대신, 서버 안의 SSM Agent가 AWS에서 명령을 받아 실행하는 방식이에요. 서버가 AWS에 "나 맞아요"라고 증명하려면 역할(IAM Role)을 붙여야 해요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `IAM → 역할 생성 → 신뢰할 엔터티: AWS 서비스 / EC2
  권한: AmazonSSMManagedInstanceCore (이것만)
  이름: backend-visualized-ec2-ssm
EC2 → 인스턴스 → 작업 → 보안 → IAM 역할 수정 → backend-visualized-ec2-ssm`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `sudo snap services amazon-ssm-agent          # Ubuntu AMI에 기본으로 깔려 있음
TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/
#   → 역할 "이름"만 확인 (자격 증명 값은 조회하지 않음)
sudo snap restart amazon-ssm-agent
sudo tail -n 30 /var/log/amazon/ssm/amazon-ssm-agent.log | grep -E 'ERROR|Credentials'`,
      },
    ],
    result: '`backend-visualized-ec2-ssm` (HTTP 200) · `[CredentialRefresher] Credentials ready`',
  },
  {
    title: 'GitHub OIDC + 배포용 IAM 역할',
    reason: 'oidc',
    plain:
      'GitHub에 AWS 열쇠를 저장하지 않아요. 대신 GitHub가 "이건 POcodingWER/backend-visualized의 main이에요"라는 증명서(OIDC 토큰)를 내고, AWS가 그걸 확인한 뒤 1시간짜리 임시 열쇠를 줘요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `IAM → 자격 증명 공급자 → 추가 → OpenID Connect
  URL token.actions.githubusercontent.com · 대상(audience) sts.amazonaws.com
IAM → 역할 생성 → 웹 자격 증명 → 위 공급자 → 이름 backend-visualized-github-deploy`,
      },
      {
        where: '브라우저 (AWS 콘솔)',
        code: `// 신뢰 정책 (누가 이 역할을 쓸 수 있나)
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::071732232414:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:POcodingWER@89626659/backend-visualized@1425018571:ref:refs/heads/main"
    }
  }
}`,
      },
      {
        where: '브라우저 (AWS 콘솔)',
        code: `// 인라인 정책 ssm-deploy-only (이 서버에 셸 명령 보내기 + 결과 조회만)
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:ap-northeast-2:071732232414:instance/i-0c7a663e814fc808d",
        "arn:aws:ssm:ap-northeast-2::document/AWS-RunShellScript"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"],
      "Resource": "*"
    }
  ]
}`,
      },
      {
        where: '내 맥',
        code: `# GitHub가 실제로 만드는 sub 형식 확인 (읽기 전용 API)
gh api repos/POcodingWER/backend-visualized/actions/oidc/customization/sub
#   {"use_immutable_subject":true,"sub_claim_prefix":"repo:POcodingWER@89626659/backend-visualized@1425018571"}`,
      },
    ],
  },
  {
    title: 'Vercel 화면이 API를 부를 수 있게 (CORS)',
    plain:
      '브라우저는 다른 주소의 API 응답을, API가 "이 주소는 허락"이라고 해 줘야만 화면에 넘겨줘요. 서버 설정에 Vercel 주소 한 줄을 넣었어요.',
    commands: [
      {
        where: '서버 (ubuntu@EC2)',
        code: `sed -i 's|^VERCEL_ORIGIN=.*|VERCEL_ORIGIN=https://backend-visualized.vercel.app|' deploy/production.env
./deploy/compose.sh up -d api       # 그때는 API가 하나라 다시 만들기 (몇 초 끊김)
# 지금이라면: ./deploy/deploy.sh current   (같은 이미지를 다른 색으로 띄워 무중단 반영)`,
      },
      {
        where: '내 맥',
        code: `curl -si -X OPTIONS ${API_HOST}/payments \\
  -H 'Origin: https://backend-visualized.vercel.app' \\
  -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type,idempotency-key'`,
      },
    ],
    result:
      '204 · `access-control-allow-origin: https://backend-visualized.vercel.app` · `access-control-allow-credentials: true`',
  },
  {
    title: '이미지는 GitHub에서 굽고, 서버는 받기만 + blue-green 무중단 교체',
    reason: 'ghcr',
    plain:
      '서버가 직접 빌드하면 2분 동안 바빠지고, 바꿔 끼우는 순간 몇 초 끊겼어요. 그래서 GitHub의 ARM 컴퓨터가 이미지를 만들어 GHCR에 올리고, 서버는 받아서 쉬고 있는 쪽(blue/green)에 먼저 띄운 뒤 문만 바꿔 달아요.',
    commands: [
      {
        where: 'GitHub',
        code: `# .github/workflows/deploy.yml (요약)
target  → 배포할 커밋 SHA 결정 (main에 있는 커밋인지 확인)
image   → runs-on: ubuntu-24.04-arm, permissions: packages: write
          docker/build-push-action → ghcr.io/pocodingwer/backend-visualized-api:<SHA>, :main
deploy  → permissions: id-token: write → aws-actions/configure-aws-credentials (OIDC)
          aws ssm send-command --document-name AWS-RunShellScript --instance-ids i-0c7a663e814fc808d
          → get-command-invocation 5초마다 확인 → https://…/health 200 확인`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `# SSM이 서버에서 실행하는 명령 (root → ubuntu)
sudo -u ubuntu bash -lc 'set -euo pipefail; cd /opt/backend-visualized;
  git fetch --prune origin main; git reset --hard origin/main;
  ./deploy/deploy.sh <커밋 SHA>'

# deploy/deploy.sh가 하는 일
docker pull -q ghcr.io/pocodingwer/backend-visualized-api:<SHA>
./deploy/compose.sh up -d --no-deps --force-recreate api_green      # 쉬던 색에 새 이미지
./deploy/compose.sh exec -T caddy wget -q -O /dev/null http://api_green:4000/health   # 될 때까지
# deploy/caddy/upstream.caddy → reverse_proxy api_green:4000
./deploy/compose.sh exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
sleep 10 && ./deploy/compose.sh stop api_blue                        # 진행 중 요청 마무리 후`,
      },
      {
        where: '내 맥',
        code: `# 배포 중 0.2초마다 health를 찔러서 200이 아닌 응답 세기
while true; do
  curl -s -o /dev/null -w '%{http_code} %{time_total}\\n' --max-time 3 ${API_HOST}/health
  sleep 0.2
done | awk '$1 != 200'`,
      },
    ],
    result: '배포 3번 동안 862 · 705 · 565번 요청, 200이 아닌 응답 0번',
  },
  {
    title: '매일 DB 백업 + S3에 한 부 더 + 진짜 복원해 보기',
    plain:
      'DB가 같은 서버에 있어서 서버가 망가지면 데이터도 같이 사라져요. 매일 새벽 4시에 통째로 복사해서 서버와 S3에 한 부씩 두고, 그 복사본이 진짜 되살아나는지도 확인했어요.',
    commands: [
      {
        where: '저장소 파일',
        code: `# deploy/cron/backend-visualized-backup → /etc/cron.d/ (deploy.sh가 배포 때마다 설치)
0 4 * * * ubuntu /opt/backend-visualized/deploy/backup-mysql.sh >> /opt/backend-visualized/backups/backup.log 2>&1`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `# backup-mysql.sh의 핵심: 비밀번호는 컨테이너 안의 환경 변수를 그 안에서만 씀
./deploy/compose.sh exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec nice -n 19 mysqldump -uroot \\
    --single-transaction --quick --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF backend_visualized' \\
  | nice -n 19 ionice -c3 gzip -6 > backups/backend_visualized-20261021-094109-KST.sql.gz.partial
gzip -t …partial && zcat …partial | tail -n 1     # "-- Dump completed" 일 때만 이름 바꾸기
find backups -name 'backend_visualized-*-KST.sql.gz' -mtime +6 -delete    # 7일 보관

./deploy/install-backup-cron.sh       # cron 설치 (몇 번 해도 같음)
./deploy/backup-mysql.sh              # 지금 바로 한 번
./deploy/restore-test.sh              # 임시 DB에 복원 → 행 수 비교 → 임시 DB 삭제

# 서버 밖 한 부: production.env에 BACKUP_S3_BUCKET이 있으면 업로드까지
echo 'BACKUP_S3_BUCKET=backend-visualized-db-backups' >> deploy/production.env
aws s3 cp backups/<파일> s3://backend-visualized-db-backups/mysql/<파일> --only-show-errors
aws s3api head-object --bucket backend-visualized-db-backups --key mysql/<파일>   # 403 (쓰기 전용이라 정상)`,
      },
      {
        where: '브라우저 (AWS 콘솔)',
        code: `S3 → 버킷 만들기 backend-visualized-db-backups (서울)
  퍼블릭 액세스 차단 켬 · 버전 관리 켬 · 기본 암호화 SSE-S3
  수명 주기 규칙 expire-mysql-backups (접두사 mysql/)
    현재 버전 30일 뒤 만료 · 이전 버전 7일 뒤 삭제 · 미완료 멀티파트 1일 뒤 삭제
IAM → 역할 backend-visualized-ec2-ssm → 인라인 정책 s3-backup-put-only
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::backend-visualized-db-backups/mysql/*"
    }
  ]
}`,
      },
    ],
    result:
      '12K · 0.26초 · 메모리 28MB · `RESTORE_TEST=PASS` (11개 테이블 행 수 모두 일치) · S3 업로드 `mysql/backend_visualized-20261021-095322-KST.sql.gz` (10,883 bytes)',
  },
];
