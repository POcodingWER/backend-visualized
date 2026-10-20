import { githubFile } from '../../lib/site';
import type { DevFlowContent } from '../components/molecules/DevFlow';

/** 6장 "개발자용 자세히" 글. 표 값은 2026-10-20 로컬 Redis(bv-redis:6380)와 MySQL에서 한 번 돌리고 읽은 것 */
export const CACHE_DEV_FLOW: DevFlowContent = {
  terms: [
    {
      analogy: '주방',
      term: (
        <>
          MySQL. 원본 메뉴가 든 <code>MenuBoard</code> 행
        </>
      ),
    },
    {
      analogy: '메뉴판',
      term: (
        <>
          Redis 키 <code>bv:menu:board</code>
        </>
      ),
    },
    {
      analogy: '5초마다 새로 확인',
      term: (
        <>
          TTL: <code>SET key value EX 5</code>
        </>
      ),
    },
    {
      analogy: '메뉴판 먼저, 없으면 주방',
      term: (
        <>
          <b>cache-aside</b>: <code>GET</code> → miss → <code>SELECT</code> → <code>SET EX</code>
        </>
      ),
    },
    {
      analogy: '비는 순간 몰림',
      term: (
        <>
          <b>cache stampede</b> (thundering herd)
        </>
      ),
    },
    {
      analogy: '서버마다 한 명',
      term: (
        <>프로세스 안의 single-flight. 2장 토큰 갱신과 같은 코드예요 (API용으로 복사해 둔 파일)</>
      ),
    },
    {
      analogy: '열쇠',
      term: (
        <>
          분산 잠금 <code>SET bv:menu:board:lock &lt;token&gt; NX PX 2000</code>
        </>
      ),
    },
    {
      analogy: '메뉴판 지우기',
      term: (
        <>
          <b>무효화</b> (<code>DEL</code>)
        </>
      ),
    },
  ],
  steps: [
    {
      who: '브라우저 → API',
      what: (
        <>
          <code>readMenu(&apos;cache&apos;)</code>가 <code>GET /cache-demo/menu?via=cache</code>를
          보내요.
        </>
      ),
    },
    {
      who: 'API → Redis',
      what: (
        <>
          <code>readThroughCache()</code>가 <code>GET bv:menu:board</code>를 해요.
        </>
      ),
      branches: [
        <>
          hit: 200 <code>{'{ board, source: "cache", hops, ttlLeftMs }'}</code> (남은 시간은{' '}
          <code>PTTL</code>)
        </>,
        <>
          miss: MySQL에서 <code>MenuBoard</code>를 읽고 → <code>SET … EX 5</code> → 200{' '}
          <code>source: &quot;db&quot;</code>
        </>,
      ],
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          <code>via=db</code>면 <code>readDirect()</code>가 Redis 없이 매번 <code>SELECT</code>해요.
        </>
      ),
    },
    {
      who: '브라우저 → API → MySQL·Redis',
      what: (
        <>
          메뉴 바꾸기: <code>POST /cache-demo/menu</code> <code>{'{ invalidate }'}</code> →{' '}
          <code>UPDATE MenuBoard</code>(version + 1).
        </>
      ),
      branches: [
        <>
          invalidate가 true면 바로 <code>DEL bv:menu:board</code> → 다음 읽기부터 새 메뉴
        </>,
        <>false면 TTL(최대 5초)이 끝날 때까지 옛 메뉴. 화면은 0.5초마다 읽어서 확인해요</>,
      ],
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          몰림 실험: <code>POST /cache-demo/stampede</code>{' '}
          <code>{'{ visitors: 1000, instances: 3 }'}</code>. <code>runSimulation</code>{' '}
          관문(409/429)을 지나요.
        </>
      ),
    },
    {
      who: 'API → Redis·MySQL',
      what: (
        <>
          대책마다 캐시와 잠금 키를 <code>DEL</code>해서 &quot;막 만료된 순간&quot;을 만들고, 손님
          1000명을 서버 3대(한 프로세스 안에서 흉내)에 나눠 동시에 읽혀요.
        </>
      ),
      branches: [
        <>대책 없음: 모두 miss → 모두 SELECT + SET EX</>,
        <>single-flight: 서버마다 한 명만 SELECT, 나머지는 그 Promise를 같이 기다려요</>,
        <>
          Redis 잠금: <code>SET NX PX 2000</code>을 잡은 한 명만 SELECT → <code>SET EX</code> → 내
          토큰일 때만 <code>DEL</code>하는 Lua. 나머지는 20ms마다 <code>GET</code>, 1초가 넘으면
          DB에서 직접 읽어요 (db-fallback)
        </>,
      ],
    },
    {
      who: 'API → 브라우저',
      what: (
        <>
          200 <code>{'{ results: [...] }'}</code>. 대책마다 DB 읽기 수, Redis 명령 수(GET, SET EX,
          SET NX, DEL), 손님별 경로가 들어 있어요.
        </>
      ),
    },
  ],
  samplesTitle: 'Redis·DB에는 이렇게 남아요',
  samples: [
    {
      caption: 'Redis 키 (한 번 실행한 예)',
      note: (
        <>
          <code>bv-redis</code>에서 직접 읽었어요. <code>PTTL</code>은 남은 밀리초, -2는 키가 없다는
          뜻이에요.
        </>
      ),
      columns: ['key', 'type', 'value', 'PTTL', '언제'],
      rows: [
        [
          'bv:menu:board',
          'string',
          <code key="v">{'{"content":"오늘의 메뉴: 김치찌개 (25번째 판)","version":25}'}</code>,
          '4970',
          'miss 뒤 SET EX 5 직후',
        ],
        [
          'bv:menu:board:lock',
          'string',
          'd8766401… (요청마다 새 UUID)',
          '1996',
          '몰림 실험(Redis 잠금) 도중',
        ],
        ['bv:menu:board:lock', 'none', '', '-2', '잠금 주인이 Lua로 DEL한 뒤'],
        ['bv:menu:board', 'none', '', '-2', '5초 뒤 TTL 만료'],
      ],
    },
    {
      caption: 'MenuBoard 행 (같은 때)',
      note: (
        <>
          캐시에 들어간 값의 원본이에요. <code>updatedAt</code>은 UTC예요.
        </>
      ),
      columns: ['id', 'name', 'content', 'version', 'updatedAt'],
      rows: [
        ['2816', 'board', '오늘의 메뉴: 김치찌개 (25번째 판)', '25', '2026-10-20 04:35:15.916'],
      ],
    },
  ],
  notes: [
    {
      title: '그림의 말 ↔ 실제 명령',
      items: [
        <>
          메뉴판에 있을 때: <code>GET → hit</code>
        </>,
        <>
          없을 때: <code>GET → miss → SELECT → 행 → SET EX 5</code>
        </>,
        <>
          매번 주방에 갈 때: <code>SELECT → 행</code>
        </>,
        <>
          메뉴 바꾸기: <code>UPDATE</code> (무효화를 켜면 <code>+ DEL</code>). 몰림 실험의 Redis
          명령 수는 아래 표에 있어요.
        </>,
      ],
    },
    {
      title: '왜 Redis인가',
      items: [
        <>
          single-flight는 한 프로세스의 메모리 안에서만 묶여요. 서버를 늘리면 대수만큼 DB에 가요 (위
          3).
        </>,
        <>잠금과 메뉴판을 모든 서버가 같이 보는 곳(Redis)에 두면 서버 수와 상관없이 한 번이에요.</>,
      ],
    },
    {
      title: '한계·운영에선',
      items: [
        <>잠금을 기다리는 손님이 20ms마다 다시 GET해서 GET 수가 늘어요 (위 1999).</>,
        <>
          잠금 주인이 1초 넘게 늦으면 기다리던 손님은 DB에서 직접 읽어요 (db-fallback, 캐시는 안
          채워요).
        </>,
        <>
          무효화는 &quot;DB 수정 후 DEL&quot; 순서라, 그 사이 아주 짧게 옛 값이 다시 채워질 수
          있어요. 지연 이중 삭제나 버전 비교로 줄여요.
        </>,
        <>Redis가 꺼져 있어도 API는 떠요. 6장 요청만 실패해요 (첫 명령 때 연결).</>,
      ],
    },
    {
      title: '로컬·운영 Redis',
      items: [
        <>
          로컬: <code>docker compose up -d redis</code> → 컨테이너 <code>bv-redis</code>, 포트
          6380(다른 Redis와 안 겹치게), 디스크 저장 끔.
        </>,
        <>
          운영: <code>docker-compose.prod.yml</code>의 redis 컨테이너, <code>REDIS_URL</code>.
        </>,
      ],
    },
    {
      title: '개발자 도구로 보면',
      items: [
        <>
          <code>GET /cache-demo/menu?via=cache</code> 응답의 <code>source</code>가 cache인지 db인지,{' '}
          <code>ttlLeftMs</code>가 얼마 남았는지 보여요.
        </>,
        <>
          몰림 실험은 <code>POST /cache-demo/stampede</code> 한 건이에요. 1000명은 서버 안에서
          돌아요.
        </>,
      ],
    },
  ],
  links: [
    { label: 'cache/api.ts', href: githubFile('apps/web/app/cache/api.ts') },
    {
      label: 'cache-demo.controller.ts',
      href: githubFile('apps/api/src/cache-demo/cache-demo.controller.ts'),
    },
    {
      label: 'cache-demo.service.ts',
      href: githubFile('apps/api/src/cache-demo/cache-demo.service.ts'),
      note: 'cache-aside·잠금·무효화',
    },
    {
      label: 'common/utils/single-flight.ts',
      href: githubFile('apps/api/src/common/utils/single-flight.ts'),
    },
    { label: 'redis.service.ts', href: githubFile('apps/api/src/redis/redis.service.ts') },
    {
      label: 'docs/chapters-4-6.md',
      href: `${githubFile('docs/chapters-4-6.md')}#6장-맛집-메뉴판`,
    },
  ],
};
