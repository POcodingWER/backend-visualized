import { githubFile } from '../../lib/site';
import type { DevFlowContent } from '../components/molecules/DevFlow';

/** 1장 "개발자용 자세히" 글. 표 값은 2026-10-20 로컬 실행 한 번(500명 / 100장)에서 읽은 것 */
export const TICKETING_DEV_FLOW: DevFlowContent = {
  terms: [
    { analogy: '아무 규칙 없음', term: <>제어 없음: 읽고 → 판단하고 → 쓰기 (read-modify-write)</> },
    {
      analogy: '줄 세우기',
      term: (
        <>
          비관적 락 <code>SELECT … FOR UPDATE</code>
        </>
      ),
    },
    {
      analogy: '눈치 보고 재도전',
      term: <>낙관적 락: version 비교 후 갱신, 충돌하면 재시도 (최대 30회)</>,
    },
    {
      analogy: '한 번에 처리',
      term: (
        <>
          원자적 조건부 <code>UPDATE … WHERE issuedCount &lt; totalQuantity</code>
        </>
      ),
    },
  ],
  steps: [
    {
      who: '브라우저 → API',
      what: (
        <>
          버튼을 누르면 <code>runSimulation()</code>이 <code>POST /coupons/simulate</code>를 보내요.
          본문은 <code>{'{ users: 500, quantity: 100, strategy? }'}</code>예요.
        </>
      ),
    },
    {
      who: 'API',
      what: (
        <>
          <code>CouponsController.simulate</code>가 <code>runSimulation</code> 관문을 먼저 지나요.
        </>
      ),
      branches: [
        <>다른 실험이 돌고 있으면 409</>,
        <>
          쿨다운(끝나고 3초) 중이면 429 <code>simulation_cooldown</code> + <code>Retry-After</code>
        </>,
        <>IP당 10초에 6번을 넘으면 429 (ThrottlerGuard)</>,
      ],
    },
    {
      who: 'API → MySQL',
      what: (
        <>
          <code>CouponStrategies.simulate</code>가 쿠폰 <code>sim-&lt;전략&gt;</code>을 리셋하고,
          가상 사용자 500명의 <code>issue()</code>를 동시에 던져요. 전략을 안 고르면 4개를 차례로
          돌려요.
        </>
      ),
    },
    {
      who: 'API → MySQL',
      what: (
        <>
          요청마다 시작·끝 시각, 재시도 횟수, 락 대기 시간을 기록해요. 따로 연 커넥션
          (connection_limit=1)이 약 25ms마다 실제 행을 읽어 스냅숏도 남겨요.
        </>
      ),
    },
    {
      who: 'API → 브라우저',
      what: (
        <>
          200 <code>{'{ results: [...] }'}</code>로 돌려줘요. 전략마다 최종 행 상태, 요약, 스냅숏,
          요청 500개 기록이 들어 있어요.
        </>
      ),
    },
    {
      who: '브라우저',
      what: (
        <>
          실측 타임라인을 2.5~6초로 늘여서 다시 재생해요 (<code>useReplay</code>).
        </>
      ),
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          실험실의 DB 패널은 <code>GET /coupons/:name/state?limit=10</code>으로 실제 행을 다시
          읽어요.
        </>
      ),
    },
  ],
  samples: [
    {
      caption: 'Coupon 행 (한 번 실행한 예)',
      note: (
        <>
          500명 / 100장으로 전략 4개를 돌린 뒤 읽었어요. 마지막 칸은 <code>CouponIssue</code> 행
          수를 센 값이고, 시각은 UTC예요.
        </>
      ),
      columns: [
        'id',
        'name',
        'totalQuantity',
        'issuedCount',
        'version',
        'updatedAt',
        'CouponIssue 행 수',
      ],
      rows: [
        ['10', 'sim-none', '100', '1', '0', '2026-10-20 04:59:48.114', '500 (초과 400)'],
        ['11', 'sim-pessimistic', '100', '100', '0', '2026-10-20 04:59:48.525', '100'],
        ['13', 'sim-optimistic', '100', '100', '100', '2026-10-20 04:59:49.781', '100'],
        ['12', 'sim-atomic', '100', '100', '0', '2026-10-20 04:59:49.925', '100'],
      ],
    },
  ],
  notes: [
    {
      title: '표를 이렇게 읽어요',
      items: [
        <>
          제어 없음은 500명이 모두 &quot;아직 0장&quot;을 읽고 발급했어요. 카운터는 서로 덮어써서{' '}
          <code>issuedCount</code>가 1에 머물렀어요 (lost update).
        </>,
        <>낙관적 락만 version이 100까지 올라가요. 성공한 갱신마다 1씩 올리기 때문이에요.</>,
      ],
    },
    {
      title: '한계·운영에선',
      items: [
        <>비관적 락은 모두가 한 줄로 서서, 기다리는 트랜잭션이 DB 커넥션을 붙잡아요.</>,
        <>낙관적 락은 한 행에 몰리면 재시도가 폭증하고, 30회를 넘기면 쿠폰이 남아도 실패해요.</>,
        <>
          원자적 UPDATE는 조건이 한 문장으로 표현될 때만 써요. 1인 1매 같은 규칙은 unique 제약과
          같이 써야 해요.
        </>,
        <>
          남용 방지: 실행이 끝나면 서버 전체 3초 쿨다운, 동시 실행 1개, IP당 10초에 6번. 이 한도는
          API 한 대의 메모리에 있어요.
        </>,
      ],
    },
    {
      title: '개발자 도구로 보면',
      items: [
        <>
          Network 탭에는 <code>POST /coupons/simulate</code> 한 건만 보여요. 500명은 브라우저가
          아니라 서버 안에서 동시에 돌아요.
        </>,
        <>응답이 커요 (전략마다 요청 기록 500개). 재생 중에는 추가 요청이 없어요.</>,
      ],
    },
  ],
  links: [
    { label: 'ticketing/api.ts', href: githubFile('apps/web/app/ticketing/api.ts') },
    {
      label: 'coupons.controller.ts',
      href: githubFile('apps/api/src/coupons/coupons.controller.ts'),
    },
    {
      label: 'coupon-strategies.ts',
      href: githubFile('apps/api/src/coupons/lib/coupon-strategies.ts'),
      note: '전략 4종',
    },
    {
      label: 'coupon-strategies.spec.ts',
      href: githubFile('apps/api/src/coupons/test/coupon-strategies.spec.ts'),
      note: '실제 MySQL에서 300명 vs 50장: 제어 없음은 초과 발급, 나머지 셋은 정확히 50장',
    },
    { label: 'lib/useReplay.ts', href: githubFile('apps/web/lib/useReplay.ts'), note: '재생' },
    { label: 'docs/handover.md', href: githubFile('docs/handover.md'), note: '3. 장별 흐름' },
  ],
};
