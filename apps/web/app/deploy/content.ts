/**
 * 배포 및 회고 페이지의 이유 · 막힌 것 · 회고 글. 숫자는 ~/Desktop/deploy-log.md와 GitHub Actions 실행 기록에 있는 값만 쓴다.
 * 비밀값은 넣지 않는다 (no-secrets.test.ts).
 */

export interface Reason {
  /** 주소 끝 #reason-<id>. 단계(steps.ts의 reason)에서 이 카드로 바로 온다 */
  id: string;
  question: string;
  answer: string;
  /** 대신 떠안은 것 */
  cost?: string;
  /** 단계 칩에 붙는 짧은 이름 (한 단계에 카드가 둘일 때 "왜 GHCR? →"처럼) */
  label?: string;
  /** 카드 안의 짧은 코드 (터미널 모양으로) */
  snippet?: string;
}

export const REASONS: Reason[] = [
  {
    id: 'ssm',
    question: '왜 SSH가 아니라 SSM으로 배포하나요?',
    answer:
      'SSH로 배포하려면 서버의 SSH 포트를 밖에 열어 둬야 해요. GitHub Actions 러너는 IP가 매번 바뀌어서 사실상 넓게 열어야 하고, 서버 개인키도 GitHub에 맡겨야 해요. SSM은 서버의 에이전트가 AWS 쪽으로 먼저 연결해서 명령을 받아 오는 방식이라 배포 때문에 열어 둘 포트가 없어요. 권한은 OIDC로 받는 임시 권한이라 저장해 둔 키도 없고, "이 서버 한 대에 `AWS-RunShellScript`로만"으로 좁혀 두었고, 누가 언제 무슨 명령을 보냈는지 기록도 남아요. 솔직히 덧붙이면 SSH 포트는 하나 열려 있어요. Workbench로 DB를 보려고 쓰는 터널인데, 제 IP에서 제 키로만 들어오는 개인용 통로이고 자동 배포에는 SSH가 아예 끼지 않아요.',
    cost: 'IAM 역할 두 개와 정책을 직접 이해해야 했어요. 처음 설정이 SSH보다 훨씬 오래 걸렸어요.',
  },
  {
    id: 'ubuntu',
    question: '왜 Ubuntu 24.04인가요?',
    answer:
      '검색하면 나오는 자료가 제일 많고, Docker 공식 설치 문서가 그대로 맞고, SSM Agent가 AMI에 이미 깔려 있어요. LTS라 2029년까지 보안 업데이트가 나와요. 처음 서버를 만지는 저한테는 "막혔을 때 답을 찾을 수 있는가"가 제일 중요했어요.',
    cost: '저장소 문서는 원래 Amazon Linux 기준이라 설치 명령을 우분투에 맞게 다시 써야 했어요.',
  },
  {
    id: 'docker-mysql',
    question: '왜 RDS 대신 같은 EC2의 Docker MySQL인가요?',
    answer:
      '돈과 공부 두 가지예요. t4g.small + MySQL 컨테이너는 월 $21 정도인데, RDS db.t4g.micro를 붙이면 $41 정도로 두 배가 돼요. 그리고 RDS가 대신 해 주는 일(백업, 복원, 패치)을 한 번은 제 손으로 해 보고 싶었어요.',
    cost: '백업과 패치는 제 몫이에요. 서버 한 대가 죽으면 API와 DB가 같이 죽어요(단일 장애점). 그래서 매일 백업(서버 + S3)과 복원 테스트를 만들었고, 진짜 서비스라면 RDS로 옮길 거예요.',
  },
  {
    id: 'caddy',
    question: '왜 sslip.io + Caddy인가요?',
    answer:
      'Vercel 화면은 https라서 API도 https여야 브라우저가 막지 않고, 로그인 쿠키(`Secure`)도 https에서만 돼요. 그런데 Caddy가 기본으로 받는 Let’s Encrypt 인증서는 도메인 이름이 있어야 해요. sslip.io는 IP를 이름으로 바꿔 주는 무료 주소라 도메인을 사지 않고도 진짜 인증서를 받을 수 있었어요. Caddy는 설정 몇 줄로 인증서 발급과 갱신, http→https 이동까지 해 줘요.',
    cost: 'sslip.io는 남의 무료 서비스라 멈추면 API 주소도 멈춰요. 제 도메인이 생기면 `API_DOMAIN` 한 줄만 바꾸면 돼요.',
  },
  {
    id: 'eip',
    question: '왜 Elastic IP(고정 IP)를 붙였나요?',
    answer:
      '일반 공인 IP는 서버를 중지했다 켜면 바뀌어요. 주소가 바뀌면 sslip.io 주소, 인증서, Vercel 설정, Workbench 접속까지 다 고쳐야 해요. 실제로 한 번 바꿔 보고 나서 고정했어요.',
    cost: '공인 IPv4는 고정이든 아니든 시간당 $0.005(월 약 $3.7)가 나가요.',
  },
  {
    id: 'oidc',
    question: '왜 GitHub OIDC인가요?',
    answer:
      'AWS 열쇠(Access Key)를 GitHub Secret에 넣어 두면 언젠가 새거나 잊힌 채로 남아요. OIDC는 배포할 때마다 GitHub가 증명서를 내고 AWS가 1시간짜리 임시 열쇠를 줘요. 저장해 둔 비밀값이 아예 없어요.',
    cost: '증명서의 `sub` 글자 하나만 달라도 거절돼서, 처음엔 왜 안 되는지 찾는 데 시간이 걸렸어요.',
  },
  {
    id: 'ghcr',
    label: 'GHCR',
    question: '왜 이미지를 GHCR(GitHub 컨테이너 저장소)에 두나요?',
    answer:
      '서버가 빌드하지 않고 "받기만" 하려면 구워 둔 이미지를 둘 곳이 필요해요. GHCR은 공개 저장소면 무료이고, Actions가 따로 비밀값 없이 `GITHUB_TOKEN`으로 바로 올려요. Docker Hub처럼 계정을 하나 더 만들거나 익명 pull 횟수 제한을 신경 쓸 일도 없어요. 이미지에 `org.opencontainers.image.source` 라벨을 붙여 이 공개 저장소에 연결하니 패키지도 Public이 돼서, 서버는 로그인 없이 받아요. 태그가 커밋 SHA라 롤백은 "예전 SHA로 다시 배포"면 끝나요.',
    cost: '이미지 이름이 `deploy.yml`의 `IMAGE`와 서버의 `deploy/deploy.sh` 두 곳에 적혀 있어서, 바꿀 땐 둘 다 고쳐야 해요.',
    snippet: `# .github/workflows/deploy.yml 맨 위: 이미지 이름은 여기 한 번만
env:
  IMAGE: ghcr.io/pocodingwer/backend-visualized-api
# push할 태그와 "로그인 없이 받을 수 있나" 확인이 같은 이름을 씀 → 안 어긋남
# GHCR 이름은 소문자만 → POcodingWER 대신 pocodingwer
# 태그: <IMAGE>:<커밋 SHA> (배포·롤백용), <IMAGE>:main (지금 main 표시용)`,
  },
  {
    id: 'blue-green',
    label: 'blue-green',
    question: '왜 blue-green으로 바꿔 끼우나요?',
    answer:
      '예전엔 컨테이너를 그 자리에서 다시 만들어서, 바꿔 끼우는 순간 몇 초 끊겼어요. 이제는 쉬고 있던 쪽(blue/green)에 새 버전을 먼저 띄우고, `/health`가 200이면 문(Caddy)만 돌려요. 실패하면 문을 안 돌려서 예전 쪽이 계속 서비스해요. 배포 3번 동안 0.2초마다 862 · 705 · 565번 찔러서 실패는 0번이었고, 두 쪽이 잠깐 같이 떠도 메모리는 최고 869MiB / 1836MiB였어요. 서버 배포 job은 서버 빌드가 빠지면서 135초에서 37~51초로 줄었어요.',
    cost: '두 버전이 몇십 초 같이 돌아서, DB 구조를 바꿀 때는 "추가 먼저, 삭제는 다음 배포"(expand → contract) 순서를 지켜야 해요.',
  },
];

export interface Trouble {
  symptom: string;
  cause: string;
  fix: string;
}

export const TROUBLES: Trouble[] = [
  {
    symptom: '`Not authorized to perform sts:AssumeRoleWithWebIdentity`',
    cause:
      '이 저장소는 GitHub OIDC의 immutable subject 형식이라 `sub`에 소유자·저장소 ID가 붙어요(`repo:POcodingWER@89626659/backend-visualized@1425018571:ref:refs/heads/main`). 신뢰 정책에는 이름만 있는 예전 형식이 적혀 있어서 글자가 달랐어요.',
    fix: '`gh api …/oidc/customization/sub`로 실제 형식을 확인하고, GitHub 설정을 되돌리는 대신(그게 덜 안전해요) AWS 신뢰 정책의 `sub`를 새 형식으로 고쳤어요.',
  },
  {
    symptom: 'OIDC 로그인은 통과했는데 `AccessDenied: ssm:SendCommand`',
    cause:
      'IAM 역할에는 정책이 두 종류예요. "누가 이 역할을 빌릴 수 있나"(신뢰 정책)와 "빌린 뒤 무엇을 할 수 있나"(권한 정책). 신뢰 정책은 맞았지만 권한 정책이 하나도 없어서, 역할은 받고도 아무것도 못 했어요.',
    fix: '배포 역할에 권한(인라인) 정책 `ssm-deploy-only`를 붙였어요. `SendCommand`는 이 인스턴스 하나와 `AWS-RunShellScript` 문서로만 좁히고, 결과 조회(`GetCommandInvocation`)만 전체로 열었어요.',
  },
  {
    symptom: 'SSM에 서버가 안 보이고, 메타데이터가 404',
    cause:
      'EC2에 인스턴스 역할이 안 붙어 있었어요. `169.254.169.254`의 `iam/security-credentials/`가 404였고, SSM Agent 로그에 `no EC2 instance role found`, 30분마다 다시 시도한다고 나왔어요.',
    fix: '콘솔에서 `backend-visualized-ec2-ssm` 역할을 붙이고 `sudo snap restart amazon-ssm-agent` → 30분을 안 기다리고 바로 `Credentials ready`.',
  },
  {
    symptom: 'API는 4000번에서 도는데 밖에서 `:4000`으로는 안 열림',
    cause:
      'API 컨테이너는 Docker 안쪽 네트워크에만 4000을 열고, 보안 그룹도 4000을 막아요. 밖에서 API로 들어오는 길은 Caddy의 443 하나예요.',
    fix: '일부러 그렇게 뒀어요. Caddy가 HTTPS를 받아서 안쪽 `api_blue:4000`으로 넘겨 줘요(리버스 프록시). API는 인증서를 몰라도 되고, 밖에서 `X-Forwarded-For`를 꾸며 바로 들어올 길도 없어요.',
  },
  {
    symptom: '고정 IP가 있는데 왜 `https://3.35.59.193`이 아니라 sslip.io?',
    cause:
      'Vercel 화면은 https라서 API를 http로 부르면 브라우저가 막아요(mixed content). 그런데 Caddy가 기본으로 받는 Let’s Encrypt 인증서는 도메인 이름이 있어야 해요.',
    fix: '`3-35-59-193.sslip.io`처럼 IP를 이름으로 바꿔 주는 무료 DNS를 쓰고, Caddy가 그 이름으로 인증서를 받아요. 제 도메인이 생기면 `API_DOMAIN` 한 줄만 바꾸면 돼요.',
  },
  {
    symptom: '화면(vercel.app)과 API(sslip.io)가 다른 사이트: CORS와 로그인 쿠키',
    cause:
      'API가 허락한 주소가 아니면 브라우저가 응답을 화면에 안 넘겨요(CORS). 로그인을 이어 주는 리프레시 쿠키도 다른 사이트로 보내려면 `SameSite=None; Secure`가 있어야 하고, Safari는 원래 제3자 쿠키를 막아서(ITP) 새로고침하면 풀릴까 걱정했어요.',
    fix: '`VERCEL_ORIGIN`에 Vercel 주소를 넣고 preflight(`OPTIONS`)로 허락 헤더를 확인했어요. 쿠키는 `SameSite=None; Secure; Partitioned`. 실제 Safari에서 새로고침해도 로그인이 유지됐어요(Partitioned 덕분으로 보여요). "모든 쿠키 차단" 같은 엄격한 설정이나 오래된 버전에서는 여전히 막힐 수 있어서, 제 도메인으로 같은 사이트를 만들고 `SameSite=Lax`로 바꾸는 게 가장 튼튼해요.',
  },
  {
    symptom: 'Elastic IP로 바꾼 뒤 Workbench가 갑자기 접속 실패 (API도 잠깐 503)',
    cause:
      'Workbench의 SSH Hostname이 아직 예전 IP `13.209.4.20`을 가리키고 있었어요. API는 새 주소로 다시 뜨는 동안 Caddy가 잠깐 503을 돌려줬어요.',
    fix: 'SSH Hostname을 `3.35.59.193:22`로 바꿨고, 503은 API가 healthy가 되자 사라졌어요. IP를 바꾸면 sslip.io 주소, Vercel, Workbench, `ssh` 명령을 한 번에 같이 고쳐야 해요.',
  },
  {
    symptom: 'MySQL Workbench가 서버 MySQL에 접속을 못 함',
    cause:
      'MySQL 컨테이너는 Docker 안쪽 네트워크에만 열려 있었어요. 보안 그룹도 3306을 막고 있어서 바깥에서는 길이 아예 없었어요(그게 맞는 상태였어요).',
    fix: '3306을 인터넷에 여는 대신 `127.0.0.1:3306:3306`으로 서버 자기 자신에만 열고, Workbench는 Standard TCP/IP over SSH로 SSH 터널을 타고 들어가요.',
  },
  {
    symptom: '`caddy reload: connection refused` (첫 blue-green 배포 실패)',
    cause:
      '그 배포에서만 Caddy 컨테이너가 새로 만들어졌는데, 관리 API(`:2019`)가 뜨기 1~2초 전에 `reload`를 불러서 거절당했어요. 서비스는 이미 새 쪽을 보고 있었고, 끊긴 건 Caddy가 다시 뜨는 순간의 요청 4번(약 0.8초)이었어요.',
    fix: '`deploy.sh`가 `reload`를 1초 간격으로 최대 15번 다시 시도하게 고쳤어요. 그 뒤 배포는 전부 통과했어요.',
  },
  {
    symptom: '`deploy/caddy/upstream.caddy`가 저장소에 없음',
    cause:
      '이 파일은 "지금 어느 색이 서비스 중인가"라는 서버의 실행 상태예요. git에 넣어 두면 배포 때마다 하는 `git reset --hard origin/main`이 지금 색을 커밋된 값으로 되돌려 버려요.',
    fix: '`.gitignore`에 넣고 `deploy.sh`가 배포 때마다 만들어요(임시 파일에 쓰고 `mv`로 한 번에 바꿈). 파일이 없으면 첫 배포로 보고 blue부터 띄워요.',
  },
  {
    symptom: 'Actions 목록엔 1분 12초인데 페이지엔 37~51초?',
    cause:
      'Actions 목록의 시간은 워크플로 전체(커밋 확인 + 이미지 굽기 + 서버 배포)이고, 37~51초는 그중 서버 배포 job만이에요. 처음엔 이 둘을 섞어 적어서 읽는 사람이 헷갈렸어요.',
    fix: '숫자를 나눠 적었어요: 전체 약 1분 10초(API 코드가 바뀌면 2분 23초), 서버 배포 job 135초 → 37~51초.',
  },
];

/** 회고. 임철순의 목소리로 (프론트엔드 4년 차, 서버는 처음) */
export const RETRO = {
  hard: [
    '화면에서는 버튼을 누르면 바로 결과가 보이는데, 서버는 실패해도 아무 말이 없었어요. OIDC가 거절됐을 때도, SSM에 서버가 안 보일 때도 로그 한 줄을 찾기 전까지는 뭐가 틀렸는지 몰랐어요.',
    'AWS 콘솔은 메뉴가 너무 많아서, "어디서 고치는지" 찾는 데 실제로 고치는 시간보다 더 오래 걸렸어요.',
    '권한을 넓게 주면 금방 되는 걸 알면서도 좁게 주려니까 정책 JSON을 한 줄씩 이해해야 했어요.',
  ],
  learned: [
    '프론트에서 쓰던 "배포 버튼"이 실제로는 빌드, 이미지 저장, 권한 확인, 명령 전달, 건강 확인, 문 바꿔 달기로 쪼개진다는 걸 직접 만들어 보고 알았어요.',
    '"돌아간다"와 "운영할 수 있다"는 달랐어요. 재부팅 테스트, 0.2초마다 `/health` 찌르기, 복원 테스트처럼 일부러 깨 보고 숫자로 확인해야 마음이 놓였어요.',
    '비밀값은 처음부터 서버 안에서 만들고, 화면에는 이름만 찍는 습관이 생겼어요.',
    'CORS, SameSite 쿠키처럼 프론트에서 "서버가 막아요"라고 넘기던 것들이 서버 쪽에서는 한 줄 설정이라는 것, 그리고 그 한 줄의 의미를 이제는 설명할 수 있어요.',
  ],
  next: [
    '제 도메인 사기: 화면과 API를 같은 사이트로 묶어 엄격한 쿠키 설정에서도 로그인이 유지되게 하고, sslip.io 의존도 없애기',
    '롤백 연습: 일부러 예전 커밋으로 되돌려 보고 몇 초 걸리는지 재기',
    '모니터링과 알림: 서버가 죽거나 디스크·메모리가 차면 메일이 오게 (CloudWatch 경보)',
    'GitHub Actions의 Node 20 경고 정리: checkout, build-push, login, setup-buildx 액션 버전 올리기',
    'S3에서 실제로 내려받아 복원해 보기: 지금은 서버 안의 백업으로만 복원 테스트를 했어요',
  ],
};

/** 복원 테스트 결과 (2026-10-21 09:41 KST, deploy/restore-test.sh) */
export const RESTORE_ROWS: [table: string, rows: number][] = [
  ['Coupon', 4],
  ['CouponIssue', 763],
  ['Event', 3],
  ['EventDailyStat', 1],
  ['MenuBoard', 1],
  ['Payment', 5],
  ['PointEntry', 0],
  ['PointWallet', 0],
  ['RefreshToken', 14],
  ['User', 2],
  ['_prisma_migrations', 5],
];
