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
  /** 이 단계의 "왜?" 카드 (content.ts REASONS의 id). 카드 하나는 한 단계에만 붙는다 */
  reasons?: string[];
}

/** 화면에 보이는 API 주소 (2026-10-23부터 제 도메인). 실제 IP는 페이지에 싣지 않는다 (no-secrets.test.ts) */
const API_HOST = 'https://api.chuckplay.dev';

export const DEPLOY_STEPS: DeployStep[] = [
  {
    title: 'AWS 가입',
    plain: '가입하고 루트 계정에 MFA를 켰어요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `# 가입 → 루트 로그인 → MFA → 리전 서울
aws.amazon.com → 계정 만들기 (이메일, 결제 카드, 전화 인증)
"루트 사용자"로 로그인 → 보안 자격 증명 → MFA 할당
리전 → 아시아 태평양(서울) ap-northeast-2`,
      },
    ],
  },
  {
    title: '비용 알림 두 개',
    plain: '1센트라도 나가면 오는 알림과 월 $30 알림을 걸어 뒀어요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `# 예산 알림 두 개 (메일)
Billing and Cost Management → 예산(Budgets) → 예산 생성
  1) "제로 지출 예산"  → 1센트라도 청구되면
  2) "월별 비용 예산" → $30, 실제 85%·100% · 예상 100%`,
      },
    ],
    result: 't4g.small + 디스크 + 고정 IP를 합친 어림값이 월 $21 정도라 $30이면 넘을 일이 없어요.',
  },
  {
    title: 'EC2(서버) 만들기',
    reasons: ['ubuntu'],
    plain:
      'ARM(Graviton) t4g.small, 메모리 2GB, Ubuntu 24.04. 열쇠(키 페어)와 열 포트(보안 그룹)도 이때 정해요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `# 서버: ARM 2GB, Ubuntu 24.04, 디스크 20GB
EC2 → 인스턴스 시작 (서울)
  AMI           Ubuntu Server 24.04 LTS (Arm)
  인스턴스 유형 t4g.small  (2 vCPU, 2 GiB, 시간당 $0.0208)
  키 페어       backend-visualized.pem (다시 못 받음)
  스토리지      gp3 20 GiB
# 보안 그룹: 22는 내 IP만, 80·443만 전체 공개
  22  (SSH)     내 IP
  80  (HTTP)    0.0.0.0/0, ::/0   ← 인증서 발급 + https로 보내기
  443 (HTTPS)   0.0.0.0/0, ::/0
  3306(MySQL) · 6379(Redis) · 4000(API)은 열지 않음`,
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
        code: `# 1) 열쇠 파일은 나만 읽게 (아니면 ssh가 거절)
mv ~/Downloads/backend-visualized.pem ~/.ssh/
chmod 400 ~/.ssh/backend-visualized.pem
# 2) 접속 (처음 받은 공인 IP, 나중에 고정 IP로 바뀜)
ssh -i ~/.ssh/backend-visualized.pem ubuntu@<예전 IP>
# 3) CPU 종류 · OS 버전 · 메모리 · 디스크 확인
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
        code: String.raw`# 1) 패키지 목록 갱신 + 설치된 것 업데이트 (설정 파일은 기존 것 유지)
sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get -y \
  -o Dpkg::Options::=--force-confdef \
  -o Dpkg::Options::=--force-confold \
  upgrade

# 2) 비상용 메모리(스왑) 2GB 만들기 → 재부팅해도 유지(fstab)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
# 메모리가 정말 모자랄 때만 스왑 쓰기 (swappiness=10)
echo "vm.swappiness=10" | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -p /etc/sysctl.d/99-swappiness.conf

# 3) 서버 시계를 한국 시간으로
sudo timedatectl set-timezone Asia/Seoul

# 4) 보안 패치 매일 자동 설치 (unattended-upgrades)
sudo apt-get install -y unattended-upgrades
printf '%s\n' \
  'APT::Periodic::Update-Package-Lists "1";' \
  'APT::Periodic::Unattended-Upgrade "1";' \
  | sudo tee /etc/apt/apt.conf.d/20auto-upgrades

# 5) 확인
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
        code: String.raw`# 1) Docker 공식 저장소의 서명 키 받기
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# 2) apt에 Docker 저장소 등록 (이 CPU · 이 우분투 버전용)
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc]" \
  "https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list

# 3) Docker + Compose 설치
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# 4) sudo 없이 docker 쓰기 (다시 로그인하면 적용) + 부팅 때 자동으로 켜기
sudo usermod -aG docker ubuntu
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
        code: `# 1) git 설치 + 코드 둘 폴더를 ubuntu 사용자 것으로
sudo apt-get install -y git
sudo mkdir -p /opt/backend-visualized \
  && sudo chown ubuntu:ubuntu /opt/backend-visualized
# 2) 공개 저장소라 토큰 없이 받기 → 받은 커밋 확인
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
# 1) 이제부터 만드는 파일은 나만 읽기
umask 077
# 2) 비밀값을 서버 안에서 무작위로 만들기 (화면 · 채팅 · 내 맥에 안 남음)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)
MYSQL_PASSWORD=$(openssl rand -hex 24)
JWT_ACCESS_SECRET=$(openssl rand -base64 48)
ADMIN_API_KEY=$(openssl rand -hex 32)
# 3) 설정 파일 쓰기 (비밀값 자리는 위 변수. 이 화면에서는 가림)
cat > deploy/production.env <<ENV
COMPOSE_PROFILES=local-db
API_DOMAIN=<예전 IP-대시>.sslip.io
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
# 4) 권한 600 → 값 말고 이름만 확인 → git이 무시하는 파일(!!)인지 확인
chmod 600 deploy/production.env
grep -oE "^[A-Z_]+=" deploy/production.env | tr -d "="
git status --short --ignored deploy/`,
      },
    ],
    result:
      '실제 파일에서는 `<가림>` 자리에 `openssl`이 만든 값이 들어가요. 화면에는 "이름"만 찍어서 확인했어요.',
  },
  {
    title: 'MySQL · Redis · API 띄우기 (`docker compose`)',
    reasons: ['docker-mysql'],
    plain:
      '처음에는 서버가 직접 이미지를 만들었어요(2분). DB와 캐시를 먼저 띄우고, API는 켜지면서 테이블을 만드는 작업(마이그레이션)을 알아서 해요.',
    commands: [
      {
        where: '서버 (ubuntu@EC2)',
        code: `cd /opt/backend-visualized
# 1) (처음에만) 서버에서 API 이미지 직접 빌드: real 1m59s. 지금은 GHCR에서 받음
time docker build -f apps/api/Dockerfile -t backend-visualized-api:latest .
# 2) DB와 캐시 먼저 → 살아났는지 (healthy, PONG)
./deploy/compose.sh up -d mysql redis
docker inspect -f '{{.State.Health.Status}}' backend-visualized-mysql-1
./deploy/compose.sh exec -T redis redis-cli ping
# 3) API 띄우기 → 켜지면서 마이그레이션(테이블 만들기)
./deploy/compose.sh up -d api
./deploy/compose.sh logs api | grep -iE 'migrat|config'
# 4) DB · Redis · API 포트가 서버 밖으로 안 열렸는지
sudo ss -tlnp | grep -E ':(3306|6379|4000)\\b' || echo "밖에서 안 보임 OK"`,
      },
    ],
    result:
      '`All migrations have been successfully applied` · `[config] mode=production …` · DB·Redis·API 포트는 서버 밖으로 안 열림',
  },
  {
    title: 'HTTPS: Caddy + sslip.io',
    reasons: ['sslip', 'caddy'],
    plain:
      '인증서는 도메인에만 발급돼요. sslip.io는 `1-2-3-4.sslip.io`를 `1.2.3.4`로 알려주는 무료 주소라, 도메인 없이도 진짜 인증서를 받았어요. Caddy가 발급과 갱신을 알아서 해요.',
    commands: [
      {
        where: '서버 (ubuntu@EC2)',
        code: `# Caddy 띄우기 → 인증서 자동 발급 로그 확인
./deploy/compose.sh up -d caddy
./deploy/compose.sh logs caddy | grep -iE 'certificate|acme'
./deploy/compose.sh ps`,
      },
      {
        where: '내 맥',
        code: `# 1) https로 응답하는지
curl -sS https://<예전 IP-대시>.sslip.io/health
# 2) http로 오면 https로 보내는지 (308)
curl -sSI http://<예전 IP-대시>.sslip.io/health | head -3
# 3) 인증서 발급자 · 만료일
curl -sSv https://<예전 IP-대시>.sslip.io/health 2>&1 \\
  | grep -E 'subject:|issuer:|expire date'`,
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
        code: `# 1) 컨테이너가 재부팅 뒤 다시 켜지게 돼 있는지 (restart 정책)
docker inspect -f '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}}' $(docker ps -q)
# 2) Docker가 부팅 때 켜지는지
systemctl is-enabled docker containerd
# 3) 진짜로 재부팅
sudo systemctl reboot`,
      },
      {
        where: '내 맥',
        code: `# 5초마다 health → 언제 다시 살아나는지
while true; do
  curl -sS -m 5 https://<예전 IP-대시>.sslip.io/health; echo
  sleep 5
done`,
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
        code: `# docker-compose.prod.yml (mysql): 서버 자기 자신에만 열기
    ports:
      - '127.0.0.1:3306:3306'     # '3306:3306'이면 전 세계 공개라 금지`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `# 바뀐 설정으로 mysql 다시 만들기 (볼륨은 그대로라 데이터 유지)
./deploy/compose.sh up -d mysql
# LISTEN 127.0.0.1:3306 이면 OK
sudo ss -ltnp | grep 3306`,
      },
      {
        where: '내 맥',
        code: `# 1) SSH 터널: 내 맥의 13306 → 서버의 127.0.0.1:3306
ssh -i ~/.ssh/backend-visualized.pem -N \\
  -L 13306:127.0.0.1:3306 ubuntu@<IP>
# 2) Workbench 접속 설정: Standard TCP/IP over SSH
#   SSH Hostname <IP>:22 · SSH Username ubuntu
#   SSH Key File ~/.ssh/backend-visualized.pem
#   MySQL Hostname 127.0.0.1 · Port 3306 · Username app · 비밀번호는 키체인에만
# 3) 인터넷에서 직접은 막혀 있어야 정상 (Operation timed out)
nc -vz -G 5 <IP> 3306`,
      },
    ],
  },
  {
    title: '고정 IP(Elastic IP)로 바꾸고 주소 한 줄 고치기',
    reasons: ['eip'],
    plain:
      '일반 공인 IP는 서버를 중지했다 켜면 바뀌어요. 그러면 주소도 인증서도 다 다시 해야 해서, 계정에 묶이는 고정 IP를 붙였어요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `# 고정 IP를 받아 서버에 붙이기 (예전 IP는 반납)
EC2 → 탄력적 IP → 할당 → 연결 → backend-visualized
  <예전 IP> (반납) → <IP>`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `# 1) API 주소를 새 IP의 sslip.io 이름으로
sed -i 's/^API_DOMAIN=.*/API_DOMAIN=<IP-대시>.sslip.io/' deploy/production.env
# 2) 다시 띄우기 → Caddy가 새 주소로 인증서를 다시 받음
./deploy/compose.sh up -d`,
      },
    ],
    result: 'API 주소: `' + API_HOST + '`',
  },
  {
    title: 'SSM Agent + 서버용 IAM 역할',
    reasons: ['ssm'],
    plain:
      '자동 배포는 GitHub가 SSH로 들어오는 대신, 서버 안의 SSM Agent가 AWS에서 명령을 받아 실행하는 방식이에요. 서버가 AWS에 "나 맞아요"라고 증명하려면 역할(IAM Role)을 붙여야 해요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `# 1) 서버용 역할: SSM으로 명령 받는 권한만
IAM → 역할 생성 → 신뢰할 엔터티: AWS 서비스 / EC2
  권한: AmazonSSMManagedInstanceCore (이것만)
  이름: backend-visualized-ec2-ssm
# 2) 그 역할을 서버에 붙이기
EC2 → 인스턴스 → 작업 → 보안 → IAM 역할 수정 → backend-visualized-ec2-ssm`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `# 1) SSM Agent가 돌고 있는지 (Ubuntu AMI에 기본으로 깔려 있음)
sudo snap services amazon-ssm-agent
# 2) 역할이 붙었는지: 메타데이터에서 역할 "이름"만 (자격 증명 값은 조회하지 않음)
TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token \\
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \\
  http://169.254.169.254/latest/meta-data/iam/security-credentials/
# 3) 에이전트 재시작 → 로그에 Credentials ready면 성공
sudo snap restart amazon-ssm-agent
sudo tail -n 30 /var/log/amazon/ssm/amazon-ssm-agent.log | grep -E 'ERROR|Credentials'`,
      },
    ],
    result: '`backend-visualized-ec2-ssm` (HTTP 200) · `[CredentialRefresher] Credentials ready`',
  },
  {
    title: 'GitHub OIDC + 배포용 IAM 역할',
    reasons: ['oidc'],
    plain:
      'GitHub에 AWS 열쇠를 저장하지 않아요. 대신 GitHub가 "이건 POcodingWER/backend-visualized의 main이에요"라는 증명서(OIDC 토큰)를 내고, AWS가 그걸 확인한 뒤 1시간짜리 임시 열쇠를 줘요.',
    commands: [
      {
        where: '브라우저 (AWS 콘솔)',
        code: `# 1) AWS가 GitHub의 증명서(OIDC)를 믿게 등록
IAM → 자격 증명 공급자 → 추가 → OpenID Connect
  URL token.actions.githubusercontent.com · 대상(audience) sts.amazonaws.com
# 2) GitHub가 빌려 쓸 배포 역할
IAM → 역할 생성 → 웹 자격 증명 → 위 공급자 → 이름 backend-visualized-github-deploy`,
      },
      {
        where: '브라우저 (AWS 콘솔)',
        code: `// 신뢰 정책: 누가 이 역할을 빌릴 수 있나 (권한은 아래 인라인 정책이 따로 정함)
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::<계정ID>:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  // 이 저장소(ID까지)의 main 브랜치에서 온 증명서만
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub":
        "repo:POcodingWER@<오너ID>/backend-visualized@<저장소ID>:ref:refs/heads/main"
    }
  }
}`,
      },
      {
        where: '브라우저 (AWS 콘솔)',
        code: `// 권한(인라인) 정책 ssm-deploy-only: 역할을 빌린 뒤 할 수 있는 일
{
  "Version": "2012-10-17",
  "Statement": [
    // 1) 이 서버 하나에, AWS-RunShellScript 문서로만 명령 보내기
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:ap-northeast-2:<계정ID>:instance/<인스턴스ID>",
        "arn:aws:ssm:ap-northeast-2::document/AWS-RunShellScript"
      ]
    },
    // 2) 보낸 명령의 결과 조회
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
#   {"use_immutable_subject":true,"sub_claim_prefix":"repo:POcodingWER@<오너ID>/backend-visualized@<저장소ID>"}`,
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
        code: `# 1) 허락할 화면 주소(Vercel)를 설정 파일에
sed -i 's|^VERCEL_ORIGIN=.*|VERCEL_ORIGIN=https://backend-visualized.vercel.app|' \\
  deploy/production.env
# 2) API 다시 만들기 (그때는 API가 하나라 몇 초 끊김)
./deploy/compose.sh up -d api
# 지금이라면: ./deploy/deploy.sh current (같은 이미지를 다른 색으로 띄워 무중단 반영)`,
      },
      {
        where: '내 맥',
        code: `# 브라우저가 먼저 보내는 확인 요청(preflight)을 흉내 → 허락 헤더가 오는지
curl -si -X OPTIONS ${API_HOST}/payments \\
  -H 'Origin: https://backend-visualized.vercel.app' \\
  -H 'Access-Control-Request-Method: POST' \\
  -H 'Access-Control-Request-Headers: content-type,idempotency-key'`,
      },
    ],
    result:
      '204 · `access-control-allow-origin: https://backend-visualized.vercel.app` · `access-control-allow-credentials: true`',
  },
  {
    title: '이미지는 GitHub에서 굽고, 서버는 받기만 + blue-green 무중단 교체',
    reasons: ['ghcr', 'blue-green'],
    plain:
      '서버가 직접 빌드하면 2분 동안 바빠지고, 바꿔 끼우는 순간 몇 초 끊겼어요. 그래서 GitHub의 ARM 컴퓨터가 이미지를 만들어 GHCR에 올리고, 서버는 받아서 쉬고 있는 쪽(blue/green)에 먼저 띄운 뒤 문만 바꿔 달아요.',
    commands: [
      {
        where: 'GitHub',
        code: `# .github/workflows/deploy.yml (요약): job 세 개가 차례로
# 1) 배포할 커밋 정하기
target  → 커밋 SHA 결정 (main에 있는 커밋인지 확인)
# 2) ARM 러너에서 이미지 굽기 → GHCR에 올리기
image   → runs-on: ubuntu-24.04-arm, permissions: packages: write
          docker/build-push-action
          → ghcr.io/pocodingwer/backend-visualized-api:<SHA>, :main
# 3) OIDC로 AWS 역할 → SSM으로 서버에 명령 → 결과와 health 확인
deploy  → permissions: id-token: write
          aws-actions/configure-aws-credentials (OIDC)
          aws ssm send-command --document-name AWS-RunShellScript \\
            --instance-ids <인스턴스ID>
          → get-command-invocation 5초마다 확인
          → https://…/health 200 확인`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `# SSM이 서버에서 실행하는 명령 (root로 와서 ubuntu로 바꿔 실행)
sudo -u ubuntu bash -lc 'set -euo pipefail; cd /opt/backend-visualized;
  git fetch --prune origin main; git reset --hard origin/main;
  ./deploy/deploy.sh <커밋 SHA>'

# deploy/deploy.sh가 하는 일 (blue가 서비스 중일 때)
# 1) 이번 커밋의 이미지 받기
docker pull -q ghcr.io/pocodingwer/backend-visualized-api:<SHA>
# 2) 쉬던 색(green) 두 개를 새 이미지로 띄우기 (MySQL · Redis는 그대로)
#    마이그레이션은 _1만 (_2는 RUN_MIGRATIONS=false)
./deploy/compose.sh up -d --no-deps --force-recreate api_green_1 api_green_2
# 3) 두 개 모두 /health가 200이 될 때까지 서버 안쪽에서 확인 (_2도 같은 방법)
./deploy/compose.sh exec -T caddy \\
  wget -q -O /dev/null http://api_green_1:4000/health
# 4) Caddy가 보낼 곳을 green 두 개로 바꾸고 설정만 다시 읽기
#    deploy/caddy/upstream.caddy → reverse_proxy api_green_1:4000 api_green_2:4000
./deploy/compose.sh exec -T caddy \\
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
# 5) 진행 중이던 요청이 끝나게 10초 기다렸다가 예전 색 끄기
sleep 10 && ./deploy/compose.sh stop api_blue_1 api_blue_2`,
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
# 매일 04:00(서버 시계 KST), ubuntu 사용자로 백업 스크립트 실행 → 로그는 backup.log
0 4 * * * ubuntu /opt/backend-visualized/deploy/backup-mysql.sh >> /opt/backend-visualized/backups/backup.log 2>&1`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `# backup-mysql.sh의 핵심
# 1) 컨테이너 안에서 덤프: 비밀번호는 컨테이너의 환경 변수를 그 안에서만 씀
#    --single-transaction = 테이블을 잠그지 않고 한 시점 그대로
./deploy/compose.sh exec -T mysql sh -c \\
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec nice -n 19 mysqldump -uroot \\
    --single-transaction --quick --routines --triggers --events \\
    --no-tablespaces --set-gtid-purged=OFF backend_visualized' \\
  | nice -n 19 ionice -c3 gzip -6 \\
  > backups/backend_visualized-20261021-094109-KST.sql.gz.partial
# 2) 끝까지 써졌는지 ("-- Dump completed"일 때만 .partial을 떼고 이름 바꾸기)
gzip -t …partial && zcat …partial | tail -n 1
# 3) 7일 지난 백업 지우기
find backups -name 'backend_visualized-*-KST.sql.gz' -mtime +6 -delete

# 4) cron 설치(몇 번 해도 같음) → 지금 한 번 백업 → 임시 DB에 복원해서 행 수 비교
./deploy/install-backup-cron.sh
./deploy/backup-mysql.sh
./deploy/restore-test.sh

# 5) 서버 밖 한 부: production.env에 BACKUP_S3_BUCKET이 있으면 S3 업로드까지
echo 'BACKUP_S3_BUCKET=backend-visualized-db-backups' >> deploy/production.env
aws s3 cp backups/<파일> s3://backend-visualized-db-backups/mysql/<파일> \\
  --only-show-errors
# 읽기는 403이 정상 (서버 역할은 쓰기 전용)
aws s3api head-object --bucket backend-visualized-db-backups --key mysql/<파일>`,
      },
      {
        where: '브라우저 (AWS 콘솔)',
        code: `# 1) 백업 버킷: 공개 차단 · 버전 관리 · 암호화 · 오래된 것 자동 삭제
S3 → 버킷 만들기 backend-visualized-db-backups (서울)
  퍼블릭 액세스 차단 켬 · 버전 관리 켬 · 기본 암호화 SSE-S3
  수명 주기 규칙 expire-mysql-backups (접두사 mysql/)
    현재 버전 30일 뒤 만료 · 이전 버전 7일 뒤 삭제 · 미완료 멀티파트 1일 뒤 삭제
# 2) 서버 역할에 "mysql/ 폴더에 올리기만" 권한 추가
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
  {
    title: '장애 알아채기: 요청 번호 로그 · Sentry · 15분마다 /health',
    reasons: ['monitoring'],
    plain:
      '지금까지는 서버가 죽어도 누가 알려 주지 않았어요. 15분마다 밖에서 살아 있는지 확인하고, 오류는 Sentry로 모으고, 요청마다 번호를 붙여서 "그 오류가 로그의 어느 줄인지" 바로 찾게 했어요.',
    commands: [
      {
        where: '저장소 파일',
        code: `# .github/workflows/uptime.yml: 15분마다 /health, 3번 연속 200이 아니면 실패 → GitHub이 메일
on:
  schedule:
    - cron: '*/15 * * * *'

# apps/api/src/common/observability/
#   logger.ts     pino 한 줄 JSON 로그 + x-request-id, 토큰·쿠키·비밀번호는 [가림]
#   all-exceptions.filter.ts  오류 응답을 { statusCode, message, requestId } 로 통일
#   sentry.ts     SENTRY_DSN이 있을 때만 켜짐 (없으면 아무것도 안 함)`,
      },
      {
        where: '서버 (ubuntu@EC2)',
        code: `# Sentry를 켜려면 production.env에 한 줄 추가하고 다시 배포 (비워 두면 꺼짐)
echo 'SENTRY_DSN=https://<키>@<호스트>/<번호>' >> deploy/production.env

# 시작 로그에서 켜졌는지 확인: [config] … sentry=on
./deploy/compose.sh logs api_blue_1 | grep sentry=`,
      },
    ],
  },
];
