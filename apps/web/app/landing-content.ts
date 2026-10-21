/**
 * 첫 화면의 About me와 "여섯 장의 선택" 글. 숫자는 모두 docs/benchmarks, docs/chapters-4-6.md,
 * public/data의 실측 기록과 git 기록에 있는 값만 쓴다. 같은 내용을 docs/decisions.md에도 둔다.
 */

import { GITHUB_URL } from '../lib/site';

/** 글 안의 링크 한 조각. href가 /로 시작하면 이 사이트의 장 */
export interface TextLink {
  label: string;
  href: string;
}

/** 한 줄 + 그 줄이 가리키는 장/저장소 링크 */
export interface LinkedLine {
  text: string;
  links: TextLink[];
}

/**
 * About me. 회사 경력 숫자는 이력서(https://pocodingwer.github.io/about/)에 적힌 값만, 이 사이트 이야기는 이 저장소에 있는 것만 쓴다.
 * 순서: 가장 센 숫자 → 회사 경험이 이 사이트의 어느 장으로 이어지는지 → 끝까지 판 문제 하나.
 */
export const AUTHOR = {
  name: '임철순',
  intro:
    '서비스 10개를 운영하는 회사에서 프론트엔드를 맡아 비용과 속도를 숫자로 줄여 왔고, 이 사이트에서는 서버와 데이터베이스까지 직접 만들고 쟀어요.',
  career: '2022.06 블록체인(Solidity) 개발 → 2022.09~ 캠퍼스 B2C 모바일 앱 회사 프론트엔드',
  photoAlt: '임철순 증명사진',
  /** 비워 두면 이력서 버튼을 숨긴다 */
  resumeUrl: 'https://pocodingwer.github.io/about/',
  highlights: [
    {
      value: '88%',
      label: 'AWS 비용 절감',
      detail:
        '월 $1,500+ → $120, 1년에 약 $16,500. SSR → CSR 전환으로 65%, CloudFront 캐시 정책 세분화로 76% 추가 절감',
    },
    {
      value: '10개 · 10개월',
      label: 'Nuxt.js → React 전환 리드 (2인 팀)',
      detail:
        '충전·포인트·티켓 등 서비스 10개를 Lambda@Edge + S3 페이지 단위 배포로 하나씩 옮겼어요 (2025.01~11)',
    },
    {
      value: '80%',
      label: 'CI 빌드 시간 단축',
      detail: 'PNPM workspace + Turborepo 모노레포로 바뀐 앱만 빌드. 배포 시간 35%, 번들 25% 감소',
    },
    {
      value: '3초 → 1.2초',
      label: '초기 로딩',
      detail: 'CloudFront 요청 월 1,200만 → 100만, 캐시 적중률 90%',
    },
  ],
  /** 회사에서 만든 화면 → 이 사이트에서 서버 쪽으로 직접 재 본 장 */
  bridges: [
    {
      text: '포인트·티켓 화면을 만들며 "동시에 몰리면 서버는 어떻게 지키지?"를 직접 쟀어요',
      links: [
        { label: '1장 티켓팅', href: '/ticketing' },
        { label: '4장 포인트 통장', href: '/ledger' },
      ],
    },
    {
      text: '충전·결제(문화상품권, 가상계좌) 화면 경험 → 같은 결제가 두 번 되지 않게',
      links: [{ label: '5장 결제 버튼 두 번', href: '/double-pay' }],
    },
    {
      text: 'CloudFront 캐시로 요청을 90% 줄인 경험 → 서버 쪽 캐시(Redis)에서 같은 문제를',
      links: [{ label: '6장 맛집 메뉴판', href: '/cache' }],
    },
    {
      text: '회사에서 만든 pnpm + Turborepo 모노레포 구조 그대로 이 사이트를 만들었어요',
      links: [{ label: '이 사이트의 저장소', href: GITHUB_URL }],
    },
  ] satisfies LinkedLine[],
  /** 이 사이트에서 직접 한 서버 쪽 일 (이 저장소에 있는 사실만) */
  builtHere:
    'NestJS + Prisma + MySQL 8 + Redis 7로 API를 만들었어요. 장마다 방법을 2~4개 실제 데이터베이스로 재서 고른 이유와 포기한 이유를 남겼고, 커밋마다 GitHub Actions가 포맷 → 타입 검사 → 린트 → 테스트 → 빌드를 돌려요.',
  /** 끝까지 파고든 운영 문제 (이력서) */
  ownership: [
    '세탁기 블루투스 연결 실패(하루 40~50건 이상)를 2개월 추적: Sentry 도입을 제안·구축하고 앱 개발자와 로그 구조를 설계해 특정 기기·OS에서만 나는 걸 찾아 타임아웃·재시도를 넣었어요. 연결 실패율 80%, 고객 문의 90% 감소, 장애 대응 2시간 → 40분.',
    'AI 코드 리뷰 하네스: PR 리뷰를 Critical/Medium/Low로 자동 분류해, 150개 파일·8,000줄 PR에서 사람이 놓치기 쉬운 Critical 버그를 머지 전에 찾아 고쳤어요.',
  ],
  /**
   * /about "왜 백엔드로". 초안: AUTHOR·이력서·/deploy 회고에 있는 사실만으로 쓴 글이라 본인 확인이 필요하다.
   */
  whyBackend: [
    '회사에서 충전·포인트·티켓 화면을 만들면서도, 버튼 뒤에서 서버가 한꺼번에 몰린 요청을 어떻게 지키는지는 "API 주소" 너머의 일이었어요.',
    'CloudFront 캐시로 요청을 90% 줄여 본 뒤로, 같은 문제를 서버 쪽에서는 어떻게 푸는지 직접 재 보고 싶어졌어요.',
    '그래서 이 사이트에서 API와 데이터베이스를 만들고, AWS에 올려 끊기지 않게 배포하는 일까지 혼자 해 봤어요.',
  ],
  /** 이력서의 기술 스택 + 이 저장소에서 쓴 것 */
  stack: [
    {
      group: '프론트엔드',
      items: ['React', 'TypeScript', 'Vite', 'React Query', 'Nuxt.js', 'Vue.js', 'Next.js'],
    },
    { group: '빌드 · 모노레포', items: ['PNPM workspace', 'Turborepo'] },
    { group: '프론트 배포 (회사)', items: ['AWS Lambda@Edge', 'S3', 'CloudFront'] },
    {
      group: '품질 · 협업',
      items: ['Sentry', 'Storybook', 'style-dictionary', 'Node.js 스크립트'],
    },
    { group: '백엔드 (이 사이트)', items: ['NestJS 11', 'Prisma 6', 'MySQL 8', 'Redis 7'] },
    {
      group: '배포 · 운영 (이 사이트)',
      items: ['Docker', 'Caddy', 'EC2', 'SSM', 'IAM OIDC', 'GitHub Actions', 'GHCR', 'S3 백업'],
    },
    { group: '블록체인', items: ['Solidity', 'Ethereum', 'Web3.js', 'ethers.js'] },
  ],
  /** 경력 (이력서 그대로, 회사 이름은 쓰지 않는다) */
  timeline: [
    {
      period: '2022.09 ~ 현재',
      role: '프론트엔드 개발자',
      place: '캠퍼스 중심 B2C 모바일 앱 회사',
      summary: '독립 서비스 10개를 운영하며 기술 전환과 최적화를 맡았어요.',
      projects: [
        '2025.01~11 Nuxt.js → React 전환 리드 (서비스 10개, 2인 팀, Lambda@Edge + S3 페이지 단위 배포)',
        '2025.01~11 CloudFront 캐시 정책 세분화: CloudFront 비용 월 $500 → $120, 요청 월 1,200만 → 100만',
        '2025.04~06 세탁기 블루투스 연결 실패 추적: Sentry 도입, 연결 실패율 80% · 고객 문의 90% 감소',
        '2023.07~2024.08 언어팩(Excel → JSON) · 약관(노션 → HTML) 자동화: 업데이트 시간 70% · 90% 단축',
        'PNPM workspace + Turborepo 모노레포: CI 빌드 시간 80% 단축',
        'AI 에이전트 하네스: PR 리뷰 Critical/Medium/Low 자동 분류',
      ],
    },
    {
      period: '2022.06 ~ 2022.09',
      role: '블록체인(Solidity) 개발자',
      place: 'NFT 프로젝트',
      summary: 'Solidity 스마트 컨트랙트와 NFT 민팅 플랫폼을 만들었어요.',
      projects: [
        'Delica NFT 민팅 플랫폼: 스마트 컨트랙트 설계 + React 화면',
        'Bellygom NFT: 이더리움 기반 NFT 발행',
      ],
    },
  ],
  /** 이력서의 기술 블로그 목록과 공모전 (링크도 이력서에 있는 그대로) */
  writing: [
    {
      group: 'AWS · 프론트엔드',
      posts: [
        {
          label: 'CloudFront 캐시 최적화',
          href: 'https://pocodingwer.github.io/aws/2025/12/02/cloudfront_cache/',
        },
        {
          label: 'CloudFront 비용 절감',
          href: 'https://pocodingwer.github.io/aws/2025/12/10/cloudfront_cost_savings/',
        },
        {
          label: 'Cookie 보안 완벽 가이드',
          href: 'https://pocodingwer.github.io/front/2025/08/07/cookie/',
        },
        {
          label: 'React Query 사용법',
          href: 'https://pocodingwer.github.io/reactguide/2025/08/01/reactQuery/',
        },
      ],
    },
    {
      group: 'MCP · AI 에이전트',
      posts: [
        {
          label: '찾아줘 주차장! 개발 회고',
          href: 'https://pocodingwer.github.io/mcp/2026/07/10/find-parking-mcp-dev-history/',
        },
        {
          label: 'Cursor MCP OAuth 인증',
          href: 'https://pocodingwer.github.io/mcp/2026/07/14/cursor-mcp-oauth/',
        },
        {
          label: 'MCP 시리즈 전체',
          href: 'https://pocodingwer.github.io/mcp/2026/03/19/mcp_recommend3/',
        },
      ],
    },
  ],
  contest: {
    text: '카카오 Agentic Player 10 공모전에 "찾아줘 주차장!" MCP를 냈어요 (PlayMCP 전체 공개 · 예선 접수 완료).',
    href: 'https://playmcp.kakao.com/mcp/68948413827338498',
  },
  links: [
    { label: '블로그', href: 'https://pocodingwer.github.io' },
    { label: 'GitHub', href: 'https://github.com/POcodingWER' },
    { label: 'Instagram', href: 'https://www.instagram.com/lim_cuck' },
    { label: '이메일 cjftns01@gmail.com', href: 'mailto:cjftns01@gmail.com' },
  ],
};

export interface Decision {
  chapter: number;
  href: string;
  title: string;
  /** 쉬운 말 요약 (항상 보임) */
  summary: string;
  chose: string[];
  gaveUp: string[];
  learned: string[];
}

export const DECISIONS: Decision[] = [
  {
    chapter: 1,
    href: '/ticketing',
    title: '선착순 표 100장: 줄 세우기 대신 "남았으면 팔기"를 한 번에',
    summary:
      '"남았으면 1 늘리기"를 데이터베이스 한 문장에 맡겼어요. 500명이 동시에 눌러도 정확히 100장이 나갔고, 줄 세우기보다 약 4배 빨랐어요.',
    chose: [
      '원자적 조건부 UPDATE: UPDATE Coupon SET issuedCount = issuedCount + 1 WHERE id = ? AND issuedCount < totalQuantity. 1행이 바뀌면 발급 행을 INSERT, 0행이면 품절.',
      '확인과 증가가 한 문장이라 그 사이에 다른 요청이 끼어들 틈이 없어요. 500명·100장, 3회 측정에서 0.46 / 0.39 / 0.41초, 초과 발급 0장. 네 방법 중 코드도 가장 짧았어요.',
    ],
    gaveUp: [
      '비관적 락(SELECT … FOR UPDATE): 정확히 100장이지만 1.68~1.73초. 트랜잭션이 커넥션을 쥔 채 줄을 서서, 줄이 길면 커넥션 풀이 마를 수 있어요.',
      '낙관적 락(version 비교 후 재시도): 한 행에 500명이 몰리자 재시도가 약 14,140번. 30번 한도를 넘긴 440명이 실패해서 100장 중 60장만 팔렸고 23~24초 걸렸어요.',
      '이 방법의 한계도 받아들였어요. "1인 1매" 같은 규칙은 한 문장에 못 담아서, 그땐 unique 제약을 더하거나 잠금으로 가야 해요.',
    ],
    learned: [
      '비관적 락의 시간은 대부분 락이 아니라 커넥션 풀 대기였어요. 2026-10-19 기록 500건에서 중간값이 풀 대기 170.1ms, 행 락 대기 2.4ms. 전체 대기 시간의 96%가 풀 앞이었어요.',
      '낙관적 락은 충돌이 드문 데이터용이에요. 같은 행에 몰리면 재시도가 재시도를 부르는 폭풍이 돼요(다른 날 기록은 9,015번 만에 모두 성공해서, 실행마다 크게 흔들려요).',
      '아무 대책이 없으면 카운터는 1인데 실제 발급 행은 500개였어요. 카운터만 믿으면 안 되고 실제 행 수로 검증해야 한다는 걸 테스트(300명 vs 50장, 실제 MySQL)로 고정했어요.',
    ],
  },
  {
    chapter: 2,
    href: '/wristband',
    title: '로그인 유지: 손목밴드는 메모리에, 재발급 영수증은 스크립트가 못 여는 쿠키에',
    summary:
      '금방 만료되는 손목밴드는 메모리에만 두고, 재발급 영수증은 쓸 때마다 새것으로 바꿔요. 그래서 복사본은 처음 쓰이는 순간 들켜요.',
    chose: [
      '액세스 토큰: JWT(HS256), 기본 20초, 자바스크립트 메모리에만. 리프레시 토큰: 랜덤 32바이트, 24시간, httpOnly 쿠키(Path=/auth, SameSite=Lax). DB에는 SHA-256 해시만 저장해서 DB가 새도 토큰으로 못 써요.',
      '리프레시할 때마다 토큰을 회전하고, 이미 쓴 토큰이 다시 오면 그 로그인(패밀리)의 토큰을 전부 폐기해요. active → used는 조건부 UPDATE라 같은 토큰이 동시에 와도 정확히 하나만 성공해요.',
    ],
    gaveUp: [
      'localStorage: 실측에서 나쁜 스크립트가 3곳 중 localStorage만 열었어요(메모리, httpOnly 쿠키는 못 엶). 편하지만 XSS 한 번에 토큰이 통째로 새요.',
      '오래가는 액세스 토큰 하나: 서명만으로 검증해서 빠르지만 폐기할 방법이 없어요. 그래서 수명을 짧게 하고 폐기 가능한 리프레시 토큰을 따로 뒀어요.',
      '재사용 유예 기간(grace period): 실무에선 직전 토큰을 잠깐 봐주기도 하지만, 원리를 보이려고 엄격하게 처리했어요. 대가로 클라이언트가 동시 요청을 직접 묶어야 해요. 쿠키는 자동 전송되니 CSRF는 SameSite·Path·CORS로 줄였어요.',
    ],
    learned: [
      '보안 규칙이 엄격할수록 클라이언트 동시성이 중요해졌어요. 만료 순간 요청 5개가 각자 refresh하면 1번만 회전하고 4번은 재사용으로 걸려 로그인이 통째로 취소됐어요. 진행 중인 refresh를 공유(single-flight)해서 5번 → 1번.',
      '개발 모드의 React StrictMode가 effect를 두 번 돌려서, 새로고침 복구가 refresh를 두 번 보내면 그것도 재사용으로 보여요. refresh를 모듈 단위 single-flight 하나로 공유해서 해결했어요.',
    ],
  },
  {
    chapter: 3,
    href: '/delivery',
    title: '클릭 기록: 바로 저장 대신 모아서 한 번에',
    summary:
      '클릭 기록을 하나씩 보내지 않고 모았다가 한 번에 보내요. 10,000개를 보내는 데 18.7초 걸리던 게 0.29초가 됐어요.',
    chose: [
      '직접 만든 SDK가 큐에 모았다가 개수나 시간이 차면 POST /events/batch로 보내고(데모 화면은 10개 또는 10초), 서버는 createMany 한 문장으로 저장해요.',
      '페이지를 떠날 땐 sendBeacon(text/plain이라 CORS preflight 없음), 실패한 묶음은 localStorage에 보관했다가 다시 보내요. 차트는 원본 대신 5분마다 KST 날짜별로 정리한 집계표(EventDailyStat)를 읽고, 입구는 IP당 10초 200요청으로 제한해요.',
    ],
    gaveUp: [
      '하나씩 바로 보내기: 가장 실시간이지만 같은 10,000개에 요청 10,000번, 18.7초(동시 10).',
      '차트를 볼 때마다 원본 세기: 늘 정확하지만 원본이 쌓일수록 느려져요. 최대 5분 늦는 집계를 택했어요.',
      '묶음은 한 문장이라 일부만 실패할 수 없어요. 하나가 문제면 100개가 함께 실패하는 걸 받아들이고, SDK가 묶음 단위로 재시도해요.',
    ],
    learned: [
      '하나씩 보내기의 병목은 HTTP보다 DB 커밋 횟수였어요. DB에 직접 create 10,000번(순차) 70.4초 vs createMany 100개씩 1.21초, 다시 재면 75.0초 vs 1.04초(58~72배). MySQL 기본값(innodb_flush_log_at_trx_commit=1)이라 커밋마다 디스크에 써요.',
      'HTTP 단건(동시 10) 18.7초가 DB 단건(동시 10) 20.6초·15.2초와 비슷했어요. 요청을 줄이는 것보다 커밋을 줄이는 게 본질이었어요.',
      '집계는 날짜 경계가 중요했어요. 한국 서비스라 KST 자정 기준으로 고정했어요.',
    ],
  },
  {
    chapter: 4,
    href: '/ledger',
    title: '포인트: 잔액 숫자만 고치지 않고, 통장처럼 내역을 남기기',
    summary:
      '적립·사용 200건이 동시에 몰리자 잔액 숫자만 고치는 방식에선 10,100P가 사라졌어요. 내역을 남기고 잔액과 맞춰 보는 방식은 0P.',
    chose: [
      '원장(PointEntry)은 추가만 하고 고치지 않아요. 한 트랜잭션에서 SELECT balance … FOR UPDATE → 0 미만이면 거절 → 내역 INSERT → balance = balance + amount.',
      '잔액 칸과 내역 합계(SUM)를 비교하는 대사로 어긋남을 바로 잡아내요. 측정: 시작 5,000P, +100P × 150건, −100P × 50건 동시 → 잔액 15,000P = 내역 합계 15,000P. 15,100P를 쓰려는 요청은 거절.',
    ],
    gaveUp: [
      '잔액 덮어쓰기(읽고 → 더해서 → 덮어쓰기): 0.11초로 더 빠르지만 잔액이 4,900P로 끝나 10,100P가 사라졌어요.',
      '통장 방식은 0.26초로 느려요. 지갑 한 행을 잠그니 한 사람에게 요청이 몰리면 줄이 길어져요. 실무라면 잔액을 SUM으로만 계산하거나, 잔액 칸은 캐시로 두고 대사 작업으로 검증하는 방법도 있어요.',
    ],
    learned: [
      '사라진 양이 실행마다 달랐어요(다른 실행에선 9,900P). 동시성 버그는 재현이 들쭉날쭉해서, "내역 합계와 비교" 같은 검증 장치가 있어야 잡혀요.',
      '잔액은 결과이고 내역이 근거예요. 덮어쓰기 방식도 내역은 남겼기 때문에 "합계 15,000P인데 잔액 4,900P"라고 사라진 양을 정확히 셀 수 있었어요. 내역이 없었다면 사라진 줄도 몰랐을 거예요.',
    ],
  },
  {
    chapter: 5,
    href: '/double-pay',
    title: '결제: 버튼을 잠그는 대신 결제 시도마다 번호표(Idempotency-Key)',
    summary:
      '버튼 세 번에 앱의 자동 재시도까지 요청 4개가 나가면, 번호표가 없을 땐 4번 결제됐어요. 같은 번호표를 붙이니 1번.',
    chose: [
      '앱이 결제 시도마다 UUID를 만들어 Idempotency-Key 헤더로 보내고, 재시도에도 같은 값을 써요.',
      '서버는 조회보다 INSERT Payment(status=processing)를 먼저 시도해요. idempotencyKey가 UNIQUE라 동시에 와도 한 행만 성공하고(P2002), 진 요청은 50ms마다 조회해 paid가 되면 같은 결제를 돌려줘요(Idempotent-Replayed: true). 같은 키에 다른 주문·금액이면 422.',
    ],
    gaveUp: [
      '버튼 잠금만: 한 번만 눌러도 앱의 자동 재시도 때문에 2번 결제됐어요.',
      '"먼저 조회해 보고 없으면 저장": 동시 요청이 둘 다 "없음"을 봐서 막지 못해요. 그래서 DB의 UNIQUE 제약에 맡겼어요.',
    ],
    learned: [
      '중복 결제는 사용자 실수보다 타임아웃 재시도에서 생겨요. 데모에서 앱은 0.6초 안에 답이 없으면 다시 보내는데, 결제사 승인은 0.9초 걸려요.',
      '통합 테스트로 같은 키 5개를 동시에 보내 행 1개, 응답 5개 모두 같은 결제 id인 걸 확인했어요. 결제사 호출 중 서버가 죽으면 그 키가 processing으로 남는데, 매분 도는 정리 작업이 5분 넘은 processing을 실패(failed)로 닫아요. 데모의 가짜 결제사는 승인 기록이 없으니 "돈이 안 나갔다"로 보고, 진짜 결제사라면 여기서 승인 여부를 다시 물어봐야 해요.',
    ],
  },
  {
    chapter: 6,
    href: '/cache',
    title: '맛집 메뉴판: 캐시는 빠르게, 바뀐 메뉴는 제때',
    summary:
      '손님 1000명이 같은 메뉴를 물어도 데이터베이스엔 1번만 가요. 대신 메뉴가 바뀌면 최대 5초 늦어서, 고칠 때 메뉴판을 지워요.',
    chose: [
      'cache-aside: Redis GET → 없으면 MySQL SELECT → SET EX 5. 1000명 읽기에서 DB 1000번(63ms) → 1번(23ms).',
      '메뉴를 고칠 때 DEL로 무효화해요. 새 메뉴가 보이기까지 5.2초(남은 TTL) → 0초.',
      '메뉴판이 비는 순간 1000명이 몰리는 스탬피드엔 Redis 잠금(SET … NX PX 2000)으로 잡은 한 명만 DB에 가요. 내 토큰일 때만 DEL(Lua), 나머지는 20ms마다 GET, 1초 넘으면 DB에서 직접 읽어요.',
    ],
    gaveUp: [
      '대책 없음: 비는 순간 1000명 전부 DB로(1000번, 96ms).',
      '프로세스 안 single-flight: 서버 한 대에선 가장 빨라요(10ms). 하지만 서버 3대를 흉내 내니 DB가 3번, 서버 수만큼 늘어나요.',
      'Redis 잠금의 대가: 기다리는 손님이 다시 물어서 GET이 1999번으로 늘고 45ms. DB는 서버 수와 상관없이 1번이라 이걸 택했어요.',
    ],
    learned: [
      'Prisma findUnique는 같은 틱의 호출을 한 쿼리로 묶어요. "DB 1000번"이 실제로는 1번이라 측정이 거짓말을 하고 있었어요. findFirst로 바꾸고 MySQL Com_select 증가량으로 약 1,000개를 확인했어요.',
      '빈 DB에서 첫 손님 1000명이 동시에 메뉴 행을 만들다 unique 충돌(P2002)로 500 오류가 났어요. 만들다 충돌하면 다시 읽도록 고치고 회귀 테스트를 더했어요.',
      'CI에선 Turborepo가 허용 목록에 없는 환경 변수를 테스트에 넘기지 않아 REDIS_URL이 빠졌어요(globalPassThroughEnv에 추가). 로컬에선 통과하고 CI에서만 깨져서, 빌드 도구의 환경 변수 규칙까지 봐야 했어요.',
      'CloudFront에선 캐시 적중률을 올리는 게 목표였다면, 여기선 "메뉴판이 비는 순간"과 "메뉴가 바뀐 순간"을 다루는 게 핵심이었어요.',
    ],
  },
];
