import { githubFile } from '../../lib/site';
import type { DevFlowContent } from '../components/molecules/DevFlow';

/** 2장 "개발자용 자세히" 글. 표 값은 2026-10-20 로컬에서 로그인 → 회전 2번 → 복사본 제출을 한 번 돌려 읽은 것 */
export const WRISTBAND_DEV_FLOW: DevFlowContent = {
  terms: [
    {
      analogy: '손목밴드',
      term: <>액세스 토큰 (JWT, 짧게 씀). 화면 기본 15초, 서버 기본 20초</>,
    },
    {
      analogy: '재발급 영수증',
      term: <>리프레시 토큰 (기본 1일). DB에는 원문 대신 SHA-256 해시만 저장</>,
    },
    { analogy: '주머니', term: <>메모리 (자바스크립트 변수). 액세스 토큰을 여기에 둬요</> },
    {
      analogy: '금고',
      term: (
        <>
          httpOnly 쿠키 <code>bv_refresh_token</code> (<code>Path=/auth</code>)
        </>
      ),
    },
    { analogy: '가방', term: <>localStorage. 스크립트가 다 열어 볼 수 있어요</> },
    {
      analogy: '영수증 바꾸기',
      term: <>회전(rotation): 쓴 토큰은 used, 같은 familyId로 새 토큰</>,
    },
    {
      analogy: '복사본이 들킴',
      term: <>재사용 감지: used 토큰이 또 오면 그 로그인(family) 전체 revoked</>,
    },
    { analogy: '대표 한 명만', term: <>single-flight: 동시에 401이 나도 refresh는 한 번</> },
  ],
  steps: [
    {
      who: '브라우저 → API',
      what: (
        <>
          <code>POST /auth/login</code>{' '}
          <code>{'{ username, password, accessTokenTtlSeconds }'}</code>. 모든 요청은{' '}
          <code>credentials: &apos;include&apos;</code>로 보내요.
        </>
      ),
    },
    {
      who: 'API → MySQL',
      what: (
        <>
          <code>AuthService.login</code>이 scrypt로 비밀번호를 확인하고,{' '}
          <code>RefreshTokenStore.issueNewFamily</code>가 새 familyId로 첫 토큰 행을 만들어요.
        </>
      ),
      branches: [
        <>
          비밀번호가 틀리면 401 <code>invalid_credentials</code>
        </>,
      ],
    },
    {
      who: 'API → 브라우저',
      what: (
        <>
          200 <code>{'{ user, accessToken, accessTokenExpiresAt, refreshToken }'}</code> +{' '}
          <code>Set-Cookie: bv_refresh_token=…; HttpOnly; Path=/auth</code>. 액세스 토큰은 React
          상태(메모리)에만 둬요.
        </>
      ),
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          <code>GET /auth/me</code> + <code>Authorization: Bearer &lt;액세스 토큰&gt;</code>.{' '}
          <code>AccessTokenGuard</code>가 서명과 만료만 확인해요 (DB 조회 없음).
        </>
      ),
      branches: [
        <>
          만료면 401 <code>access_token_expired</code> → 다음 단계로
        </>,
        <>
          헤더가 없거나 위조면 401 <code>access_token_missing</code> /{' '}
          <code>access_token_invalid</code>
        </>,
      ],
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          <code>refreshWithCookieOnce()</code>(single-flight)로 <code>POST /auth/refresh</code>를 한
          번만 보내요. 쿠키는 브라우저가 알아서 붙여요.
        </>
      ),
    },
    {
      who: 'API → MySQL',
      what: (
        <>
          <code>RefreshTokenStore.rotate</code>가 해시로 행을 찾고, 조건부 UPDATE(
          <code>status = &apos;active&apos;</code>일 때만 used)로 한 요청만 통과시켜요.
        </>
      ),
      branches: [
        <>
          통과: 같은 familyId, <code>parentId</code> = 방금 쓴 토큰으로 새 행 → 200 + 새 AT + 새{' '}
          <code>Set-Cookie</code>
        </>,
        <>
          이미 used: family 전체 revoked → 401 <code>refresh_token_reuse_detected</code>, 쿠키 삭제
        </>,
        <>
          revoked / 만료 / 모르는 토큰: 401 <code>refresh_token_revoked</code> /{' '}
          <code>refresh_token_expired</code> / <code>refresh_token_invalid</code>
        </>,
      ],
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          새 액세스 토큰으로 <code>GET /auth/me</code>를 한 번 더 보내요.
        </>
      ),
    },
    {
      who: '브라우저',
      what: (
        <>
          새로고침하면 메모리의 액세스 토큰이 사라져요. 페이지가 뜰 때 쿠키로{' '}
          <code>POST /auth/refresh</code>를 보내 조용히 복구해요.
        </>
      ),
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          <code>POST /auth/logout</code>은 그 family의 토큰을 모두 revoked(<code>logout</code>)로
          바꾸고 쿠키를 지워요.
        </>
      ),
    },
  ],
  samples: [
    {
      caption: 'RefreshToken 행 (한 번 실행한 예)',
      note: (
        <>
          로그인 → 회전 2번 → 도둑이 첫 토큰 복사본을 낸 뒤 읽었어요. <code>tokenHash</code>(64자)
          같은 칸은 뺐고, 시각은 UTC예요.
        </>
      ),
      columns: ['id', 'parentId', 'status', 'revokedReason', 'usedAt', 'revokedAt'],
      rows: [
        ['9eedb3f7…', 'NULL', 'revoked', 'reuse_detected', '05:00:02.957', '05:00:03.089'],
        ['5591f28d…', '9eedb3f7…', 'revoked', 'reuse_detected', '05:00:02.986', '05:00:03.089'],
        ['56081473…', '5591f28d…', 'revoked', 'reuse_detected', 'NULL', '05:00:03.089'],
      ],
    },
  ],
  notes: [
    {
      title: '표를 이렇게 읽어요',
      items: [
        <>세 행 모두 familyId가 같아요 (ac03c858…). parentId를 따라가면 회전 순서가 보여요.</>,
        <>
          복사본을 내기 전에는 위 두 행이 used, 마지막 행이 active였어요. 복사본 한 번에 셋 다 같은
          시각에 revoked가 됐어요.
        </>,
      ],
    },
    {
      title: '프론트 관점',
      items: [
        <>액세스 토큰은 메모리에만 둬요. localStorage에 두면 끼어든 스크립트가 꺼내 가요.</>,
        <>
          refresh는 꼭 single-flight로 묶어요. 동시에 5개가 따로 가면 4개가 &quot;이미 쓴
          토큰&quot;이 되어 로그인이 통째로 취소돼요.
        </>,
        <>React StrictMode에서 effect가 두 번 돌아도 같은 Promise를 공유해서 회전은 한 번이에요.</>,
      ],
    },
    {
      title: '한계·운영에선',
      items: [
        <>
          액세스 토큰은 서버가 기록하지 않아요. 로그아웃해도 만료될 때까지는 통과해요. 그래서 짧게
          둬요.
        </>,
        <>
          single-flight는 탭 하나 안에서만 묶여요. 탭 여러 개가 동시에 갱신하면 재사용 감지에 걸릴
          수 있어요.
        </>,
        <>
          웹과 API가 다른 사이트면 쿠키가 <code>SameSite=None; Secure</code>(+ Partitioned)여야
          해요.
        </>,
        <>
          도둑 데모용 <code>/auth/demo/*</code>는 <code>AUTH_DEMO_ENDPOINTS=true</code>일 때만
          열려요. 운영에선 끄세요.
        </>,
      ],
    },
    {
      title: '개발자 도구로 보면',
      items: [
        <>
          Application → Cookies에 <code>bv_refresh_token</code>이 HttpOnly로 보여요. 콘솔의{' '}
          <code>document.cookie</code>로는 안 보여요.
        </>,
        <>
          쿠키는 <code>/auth</code> 경로 요청에만 붙어요. <code>POST /auth/refresh</code>의 요청
          헤더에서 <code>Cookie</code>, 응답에서 새 <code>Set-Cookie</code>를 확인할 수 있어요.
        </>,
        <>아래 JWT 디코더로 액세스 토큰의 sub, username, familyId, iat, exp를 볼 수 있어요.</>,
      ],
    },
  ],
  links: [
    { label: 'wristband/api.ts', href: githubFile('apps/web/app/wristband/api.ts') },
    { label: 'auth.controller.ts', href: githubFile('apps/api/src/auth/auth.controller.ts') },
    { label: 'auth.service.ts', href: githubFile('apps/api/src/auth/auth.service.ts') },
    {
      label: 'refresh-token.store.ts',
      href: githubFile('apps/api/src/auth/lib/refresh-token.store.ts'),
      note: '회전·재사용 감지',
    },
    {
      label: 'access-token.guard.ts',
      href: githubFile('apps/api/src/auth/lib/access-token.guard.ts'),
    },
    {
      label: 'AuthDemo.tsx',
      href: githubFile('apps/web/app/wristband/AuthDemo.tsx'),
      note: '401 → refresh → 재시도',
    },
    { label: 'lib/single-flight.ts', href: githubFile('apps/web/lib/single-flight.ts') },
    { label: 'docs/auth-tokens.md', href: githubFile('docs/auth-tokens.md'), note: '설계 문서' },
  ],
};
