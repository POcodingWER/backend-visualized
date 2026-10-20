import { githubFile } from '../../lib/site';
import type { DevFlowContent } from '../components/molecules/DevFlow';

/** 5장 "개발자용 자세히" 글. 표 값은 2026-10-20 로컬에서 키 없이 4번, 같은 키로 4번 보낸 한 번의 실행에서 읽은 것 */
export const DOUBLE_PAY_DEV_FLOW: DevFlowContent = {
  terms: [
    {
      analogy: '번호표',
      term: (
        <>
          <code>Idempotency-Key</code> 헤더. 결제 시도 한 번마다 UUID를 만들고, 재시도에도 같은 값을
          써요
        </>
      ),
    },
    {
      analogy: '"같은 값은 한 줄만"',
      term: (
        <>
          <code>Payment.idempotencyKey</code>의 <b>UNIQUE</b> 제약
        </>
      ),
    },
    {
      analogy: '같은 영수증',
      term: (
        <>
          저장된 결과 재전송 (<code>Idempotent-Replayed: true</code> 헤더)
        </>
      ),
    },
    { analogy: '결제사', term: <>가짜 PG 승인. 0.9초 걸려요 (돈은 안 나가요)</> },
  ],
  steps: [
    {
      who: '브라우저',
      what: (
        <>
          실험마다 <code>orderId</code>를 하나 만들어요. 실험 B만 <code>crypto.randomUUID()</code>로
          키도 하나 만들어요.
        </>
      ),
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          처음 한 번은 사전 확인 <code>OPTIONS /payments</code>가 먼저 가요. 204 +{' '}
          <code>Access-Control-Max-Age: 600</code>이라 10분 동안은 다시 안 가요.
        </>
      ),
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          <code>POST /payments</code> <code>{'{ orderId, amount: 12000 }'}</code> +{' '}
          <code>Idempotency-Key</code>. 0.09초 간격으로 세 번 보내요.
        </>
      ),
      branches: [
        <>
          첫 요청이 0.6초 안에 안 끝나면 <code>AbortController</code>로 끊고, 같은 키로 한 번 더
          보내요 (앱의 자동 재시도)
        </>,
      ],
    },
    {
      who: 'API',
      what: <>컨트롤러가 키 모양과 본문을 확인해요.</>,
      branches: [
        <>키가 영문·숫자·하이픈 8~64자가 아니면 400</>,
        <>orderId 모양이 틀리거나 금액이 100~1,000,000 밖이면 400</>,
      ],
    },
    {
      who: 'API → MySQL',
      what: (
        <>
          <code>PaymentsService.pay</code>가 먼저{' '}
          <code>INSERT … status=&apos;processing&apos;</code>로 키를 선점해요.
        </>
      ),
      branches: [
        <>
          INSERT 성공: 가짜 PG 0.9초 → <code>UPDATE status=&apos;paid&apos;</code> → 201{' '}
          <code>{'{ payment, replayed: false }'}</code>
        </>,
        <>
          같은 키가 이미 있음 (Prisma <code>P2002</code>): 50ms마다 그 키의 행을 다시 읽어요
          <ul>
            <li>
              <code>paid</code>가 되면 201 <code>{'{ payment, replayed: true }'}</code> +{' '}
              <code>Idempotent-Replayed: true</code>
            </li>
            <li>같은 키인데 주문이나 금액이 다르면 422</li>
            <li>5초가 지나도 processing이면 409</li>
          </ul>
        </>,
        <>
          키가 없음: <code>idempotencyKey</code>가 NULL이라 UNIQUE에 안 걸려요. 요청마다 새 결제가
          생겨요
        </>,
      ],
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          끝날 때까지 200ms마다 <code>GET /payments?orderId=…</code>로 실제 행을 읽어요. 끝나고
          0.3초 뒤 한 번 더 읽어요.
        </>
      ),
    },
  ],
  samples: [
    {
      caption: 'Payment 행 (한 번 실행한 예)',
      note: <>주문 A는 키 없이 4번, 주문 B는 같은 키로 4번 보냈어요. 시각은 UTC예요.</>,
      columns: ['id', 'orderId', 'amount', 'status', 'idempotencyKey', 'createdAt', 'paidAt'],
      rows: [
        ['440', 'order-2c14… (B)', '12000', 'paid', 'fa617a9f…', '05:00:51.942', '05:00:52.847'],
        ['441', 'order-8ae4… (A)', '12000', 'paid', 'NULL', '05:00:51.943', '05:00:52.846'],
        ['443', 'order-8ae4… (A)', '12000', 'paid', 'NULL', '05:00:52.043', '05:00:52.946'],
        ['444', 'order-8ae4… (A)', '12000', 'paid', 'NULL', '05:00:52.140', '05:00:53.043'],
        ['446', 'order-8ae4… (A)', '12000', 'paid', 'NULL', '05:00:52.245', '05:00:53.148'],
      ],
    },
  ],
  notes: [
    {
      title: '표를 이렇게 읽어요',
      items: [
        <>주문 B는 4번 보냈는데 행이 하나예요. 나머지 3번은 440번 행을 그대로 돌려받았어요.</>,
        <>
          id 442, 445가 비어 있어요. UNIQUE에 막힌 INSERT도 auto-increment 번호는 써 버리기
          때문이에요.
        </>,
        <>createdAt과 paidAt 사이가 약 0.9초예요. 가짜 PG가 승인하는 시간이에요.</>,
      ],
    },
    {
      title: '프론트 관점',
      items: [
        <>
          버튼 <code>disabled</code>는 사람의 연타만 막아요. 타임아웃 재시도, 새로고침 후 재전송,
          모바일 네트워크의 중복 전송은 못 막아요.
        </>,
        <>그래서 키는 화면이 아니라 &quot;결제 시도&quot;에 묶어서 만들어요.</>,
        <>
          API가 <code>Access-Control-Expose-Headers</code>를 안 줘서 JS는{' '}
          <code>Idempotent-Replayed</code> 헤더를 못 읽어요. 앱은 본문의 <code>replayed</code>를
          봐요.
        </>,
      ],
    },
    {
      title: '한계·운영에선',
      items: [
        <>
          첫 요청이 PG 호출 중에 죽으면 키가 processing으로 남아요. 운영에선 오래된 processing을
          결제사에 조회해 정리하는 잡이 필요해요.
        </>,
        <>기다리는 요청은 최대 5초 동안 서버 연결을 잡고 있어요.</>,
        <>데모 행은 30분 뒤 자동으로 지워져요 (10분마다 도는 정리 잡).</>,
      ],
    },
    {
      title: '개발자 도구로 보면',
      items: [
        <>
          큰 버튼 한 번에 <code>POST /payments</code> 8개예요 (실험 A·B 각 4개, 실험마다{' '}
          <code>orderId</code> 하나).
        </>,
        <>
          끝날 때까지 200ms마다 <code>GET /payments?orderId=…</code>가 두 주문을 번갈아 조회해요.
        </>,
        <>
          빨간(canceled) 2개는 실험마다 첫 요청을 앱이 0.6초 만에 끊은 거예요. 서버는 그 요청도
          끝까지 처리해요 (A에선 결제 1건, B에선 키를 먼저 잡은 쪽).
        </>,
        <>
          재전송된 응답도 상태는 201이에요. Response Headers에서{' '}
          <code>Idempotent-Replayed: true</code>를 볼 수 있어요.
        </>,
        <>
          사전 확인(<code>OPTIONS</code>)은 10분에 한 번만 보여요. 전에는 요청에{' '}
          <code>cache: &apos;no-store&apos;</code>가 붙어 Chrome이 매번 다시 보냈어요. 지금은
          GET에만 붙여요.
        </>,
      ],
    },
  ],
  links: [
    {
      label: 'PaymentDemo.tsx',
      href: githubFile('apps/web/app/double-pay/PaymentDemo.tsx'),
      note: '연타·0.6초 재시도',
    },
    { label: 'double-pay/api.ts', href: githubFile('apps/web/app/double-pay/api.ts') },
    {
      label: 'payments.controller.ts',
      href: githubFile('apps/api/src/payments/payments.controller.ts'),
      note: '400·409·422, 응답 헤더',
    },
    {
      label: 'payments.service.ts',
      href: githubFile('apps/api/src/payments/payments.service.ts'),
      note: 'INSERT 먼저 → PG → paid',
    },
    {
      label: 'schema.prisma',
      href: githubFile('apps/api/prisma/schema.prisma'),
      note: 'Payment 모델',
    },
    { label: 'main.ts', href: githubFile('apps/api/src/main.ts'), note: 'CORS maxAge 600' },
    {
      label: 'docs/chapters-4-6.md',
      href: `${githubFile('docs/chapters-4-6.md')}#5장-결제-버튼-두-번`,
    },
  ],
};
