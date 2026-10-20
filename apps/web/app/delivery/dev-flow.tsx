import { githubFile } from '../../lib/site';
import type { DevFlowContent } from '../components/molecules/DevFlow';

/** 3장 "개발자용 자세히" 글. 표 값은 2026-10-20 로컬에서 배치 한 번(4개)을 보내고 읽은 것 */
export const DELIVERY_DEV_FLOW: DevFlowContent = {
  terms: [
    {
      analogy: '택배 상자',
      term: (
        <>
          이벤트 1개 (<code>page_view</code>, <code>button_click</code>)
        </>
      ),
    },
    { analogy: '트럭', term: <>HTTP 요청 1건</> },
    {
      analogy: '물류센터',
      term: (
        <>
          브라우저 SDK의 메모리 큐. 이 페이지는 10개가 차거나 10초마다 보내요 (SDK 기본값은
          20개·5초)
        </>
      ),
    },
    {
      analogy: '묶음배송',
      term: (
        <>
          <code>POST /events/batch</code>(1~100개) + Prisma <code>createMany</code> (INSERT 한 문장,
          커밋 한 번)
        </>
      ),
    },
    { analogy: '게이트', term: <>ThrottlerGuard: IP당 10초에 200요청, 넘으면 429</> },
    {
      analogy: '저녁 장부 정리',
      term: (
        <>
          5분마다 도는 일별 롤업 잡 (<code>EventDailyStat</code> upsert, KST 날짜 기준)
        </>
      ),
    },
  ],
  steps: [
    {
      who: '브라우저',
      what: (
        <>
          <code>tracker.track(&apos;button_click&apos;)</code>은 네트워크를 안 타고 큐에만 쌓아요.
          sessionId는 sessionStorage에 있어요.
        </>
      ),
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          10개가 차거나 10초가 되면 <code>fetch</code>로 <code>POST /events/batch</code>{' '}
          <code>{'{ events: [...] }'}</code>를 보내요 (<code>keepalive: true</code>).
        </>
      ),
    },
    {
      who: 'API',
      what: <>가드와 검증을 차례로 지나요.</>,
      branches: [
        <>IP당 10초 200요청 초과: 429</>,
        <>
          서버 전체 분당 30,000개 초과: 429 <code>global_ingest_limit</code> +{' '}
          <code>Retry-After</code>
        </>,
        <>모양이 틀리면 (예: name 없음, 101개 이상): 400</>,
      ],
    },
    {
      who: 'API → MySQL',
      what: (
        <>
          <code>EventsService.createBatch</code>가 <code>createMany</code>로 <code>Event</code>에 한
          번에 넣고 202 <code>{'{ inserted: n }'}</code>를 돌려줘요.
        </>
      ),
    },
    {
      who: 'API → 브라우저',
      what: (
        <>
          <code>EventBus</code>가 알리면 SSE <code>GET /events/stream</code>으로{' '}
          <code>{'{ added, at }'}</code>가 push돼요. 15초마다 ping도 와요.
        </>
      ),
    },
    {
      who: 'SDK',
      what: <>응답에 따라 배치를 처리해요.</>,
      branches: [
        <>2xx: 끝</>,
        <>429가 아닌 4xx: 다시 보내도 소용없어서 버려요</>,
        <>
          429, 5xx, 네트워크 오류: localStorage에 보관(최대 500개) → online 이벤트나 다음 방문 때
          다시 보내요
        </>,
        <>
          페이지를 떠날 땐 <code>navigator.sendBeacon</code>(text/plain)으로 보내요
        </>,
      ],
    },
    {
      who: 'API → MySQL',
      what: (
        <>
          5분마다 <code>AggregationService</code>가 어제~오늘(KST)을{' '}
          <code>INSERT … SELECT … ON DUPLICATE KEY UPDATE</code> 한 문장으로 다시 집계해요. 여러 번
          돌려도 결과가 같아요.
        </>
      ),
      branches: [
        <>
          &quot;지금 집계&quot; 버튼: <code>POST /events/demo/aggregate</code> (IP당 1분 6번, 서버
          전체 10초 쿨다운)
        </>,
      ],
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          일별 차트는 <code>GET /events/stats/daily</code>로 <code>EventDailyStat</code>을 읽어요.
        </>
      ),
    },
  ],
  samples: [
    {
      caption: 'Event 행 (한 번 실행한 예)',
      note: (
        <>
          배치 1건(이벤트 4개)을 보낸 뒤 읽었어요. <code>createdAt</code>은 UTC예요.
        </>
      ),
      columns: ['id', 'name', 'properties', 'sessionId', 'createdAt'],
      rows: [
        [
          '126226',
          'page_view',
          <code key="p">{'{"path":"/delivery"}'}</code>,
          'devdocs-sa…',
          '2026-10-20 05:00:14.645',
        ],
        [
          '126227',
          'button_click',
          <code key="p">{'{"button":"single"}'}</code>,
          'devdocs-sa…',
          '2026-10-20 05:00:14.645',
        ],
        [
          '126228',
          'button_click',
          <code key="p">{'{"button":"burst"}'}</code>,
          'devdocs-sa…',
          '2026-10-20 05:00:14.645',
        ],
        [
          '126229',
          'button_click',
          <code key="p">{'{"button":"burst"}'}</code>,
          'devdocs-sa…',
          '2026-10-20 05:00:14.645',
        ],
      ],
    },
    {
      caption: 'EventDailyStat 행 (같은 날)',
      note: (
        <>
          5분 롤업 잡이 만든 행이에요. <code>date</code>는 KST 날짜예요.
        </>
      ),
      columns: ['date', 'name', 'count', 'uniqueSessions', 'updatedAt'],
      rows: [
        ['2026-10-20', 'button_click', '43', '2', '2026-10-20 05:00:00.019'],
        ['2026-10-20', 'page_view', '14', '3', '2026-10-20 05:00:00.019'],
        ['2026-10-19', 'button_click', '405', '5', '2026-10-20 05:00:00.019'],
      ],
    },
  ],
  notes: [
    {
      title: '표를 이렇게 읽어요',
      items: [
        <>네 행의 createdAt이 1ms까지 같아요. INSERT 한 문장으로 들어갔다는 뜻이에요.</>,
        <>
          createdAt은 UTC로 저장돼요. 롤업은 <code>DATE(createdAt + INTERVAL 9 HOUR)</code>로 KST
          날짜에 묶어요. 그래서 UTC 15시 이후 이벤트는 다음 날로 가요.
        </>,
      ],
    },
    {
      title: '한계·운영에선',
      items: [
        <>
          배치는 한 덩어리예요. 이벤트 하나만 모양이 틀려도 400이 나고, SDK는 그 배치를 통째로
          버려요.
        </>,
        <>
          DB 오류(5xx)면 배치가 통째로 실패하고, SDK가 보관했다가 나중에 배치 단위로 다시 보내요.
        </>,
        <>
          저장 시각은 서버 기준이에요. SDK가 보내는 <code>occurredAt</code>은 지금은 참고용이에요.
        </>,
        <>
          EventBus와 전역 한도는 API 한 대의 메모리에 있어요. 여러 대로 늘리면 Redis pub/sub 같은
          공유 저장소가 필요해요.
        </>,
      ],
    },
    {
      title: '개발자 도구로 보면',
      items: [
        <>
          <code>POST /events/batch</code>가 클릭마다가 아니라 10개나 10초마다 한 번씩 보이고, 상태는
          202예요.
        </>,
        <>
          <code>/events/stream</code>은 Type이 eventsource예요. 눌러 보면 EventStream 탭에 push
          메시지가 쌓여요.
        </>,
        <>
          탭을 닫거나 다른 탭으로 가면 beacon(ping) 요청이 보여요. text/plain이라 사전
          확인(OPTIONS)이 없어요.
        </>,
      ],
    },
  ],
  links: [
    {
      label: 'packages/sdk/src/index.ts',
      href: githubFile('packages/sdk/src/index.ts'),
      note: '큐·배치·재전송',
    },
    {
      label: 'Pipeline.tsx',
      href: githubFile('apps/web/app/delivery/Pipeline.tsx'),
      note: 'SDK 설정·SSE',
    },
    { label: 'events.controller.ts', href: githubFile('apps/api/src/events/events.controller.ts') },
    { label: 'events.service.ts', href: githubFile('apps/api/src/events/events.service.ts') },
    {
      label: 'aggregation.service.ts',
      href: githubFile('apps/api/src/events/lib/aggregation.service.ts'),
    },
    {
      label: 'bench-ingest.ts',
      href: githubFile('apps/api/scripts/bench-ingest.ts'),
      note: '측정 스크립트',
    },
    {
      label: 'docs/benchmarks/delivery-batching.md',
      href: githubFile('docs/benchmarks/delivery-batching.md'),
    },
  ],
};
