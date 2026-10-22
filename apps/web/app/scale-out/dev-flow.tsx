import { githubFile } from '../../lib/site';
import type { DevFlowContent } from '../components/molecules/DevFlow';

/** 7장 "개발자용 자세히" 글. 설정 값은 docker-compose.prod.yml · deploy/deploy.sh · aggregation.service.ts 기준 */
export const SCALE_OUT_DEV_FLOW: DevFlowContent = {
  terms: [
    {
      analogy: '계산대',
      term: (
        <>
          API 컨테이너. 지금 서비스 중인 색의 <code>api_blue_1</code> · <code>api_blue_2</code>{' '}
          (다음 배포 땐 <code>api_green_1</code> · <code>api_green_2</code>)
        </>
      ),
    },
    {
      analogy: '계산대 하나 더 열기',
      term: (
        <>
          <b>수평 확장</b>(scale-out). 서버를 키우는(scale-up) 대신 같은 프로세스를 하나 더
        </>
      ),
    },
    {
      analogy: '입구 직원',
      term: (
        <>
          Caddy <code>reverse_proxy</code>의 <b>로드 밸런싱</b>, <code>lb_policy least_conn</code>
        </>
      ),
    },
    {
      analogy: '이름표',
      term: (
        <>
          응답 헤더 <code>x-instance-id</code> (컨테이너 환경 변수 <code>INSTANCE_NAME</code>)
        </>
      ),
    },
    {
      analogy: '마감 정산 열쇠',
      term: (
        <>
          분산 cron 잠금 <code>SET bv:cron:aggregation:&lt;5분 칸&gt; 1 NX PX 240000</code>
        </>
      ),
    },
    {
      analogy: '실험은 한 번에 하나',
      term: (
        <>
          Redis 잠금 <code>bv:simulation:&lt;이름&gt;</code> + 쿨다운 키 (예전엔 프로세스 메모리)
        </>
      ),
    },
  ],
  steps: [
    {
      who: '브라우저 → Caddy',
      what: (
        <>
          <code>GET /health</code>가 443으로 들어와요. Caddy가 HTTPS를 풀고{' '}
          <code>upstream.caddy</code>에 적힌 두 곳 중 진행 중인 요청이 적은 쪽을 골라요.
        </>
      ),
      branches: [
        <>
          30초마다 두 곳의 <code>/health</code>를 3초 안에 확인하고, 실패한 쪽엔 안 보내요
        </>,
      ],
    },
    {
      who: 'Caddy → API',
      what: (
        <>
          <code>api_blue_1:4000</code> 또는 <code>api_blue_2:4000</code>이 받아서 200과 함께{' '}
          <code>x-instance-id: api-blue-1</code>을 붙여 돌려줘요. CORS <code>exposedHeaders</code>에
          넣어서 브라우저 JS에서도 읽혀요.
        </>
      ),
    },
    {
      who: 'API → Redis (cron)',
      what: (
        <>
          5분마다 두 API의 <code>@Cron</code>이 동시에 깨어나 같은 키에 <code>SET NX</code>를
          보내요.
        </>
      ),
      branches: [
        <>
          <code>OK</code>를 받은 한 쪽만 어제~오늘 집계를 다시 해요
        </>,
        <>
          <code>nil</code>을 받은 쪽은 그냥 끝내요. 키는 4분 뒤 저절로 사라지고, 다음 5분 칸은 새
          키라서 일부러 지우지 않아요
        </>,
      ],
    },
    {
      who: '배포 (deploy.sh)',
      what: (
        <>
          쉬던 색의 <code>_1</code> · <code>_2</code>를 함께 켜고, 둘 다 건강해야{' '}
          <code>upstream.caddy</code>를 바꿔요. 마이그레이션은 <code>_1</code>만 하고{' '}
          <code>_2</code>는 <code>RUN_MIGRATIONS=false</code>예요.
        </>
      ),
    },
  ],
  samplesTitle: 'Redis에는 이렇게 남아요',
  samples: [
    {
      caption: 'cron 잠금 키 (예)',
      note: (
        <>
          5분 칸마다 키 이름이 달라져요. <code>PTTL</code>은 남은 밀리초, -2는 키가 없다는 뜻이에요.
        </>
      ),
      columns: ['key', 'value', 'PTTL', '언제'],
      rows: [
        ['bv:cron:aggregation:202610221405', '1', '약 240000', '14:05에 한 쪽이 잡은 직후'],
        ['bv:cron:aggregation:202610221405', '', '-2', '4분 뒤 저절로 만료'],
      ],
    },
  ],
  notes: [
    {
      title: '한계·운영에선',
      items: [
        <>
          코어 2개짜리 <code>t4g.small</code>이라 API 2개가 끝이에요. 배포 중엔 새 색 2개까지 잠깐
          4개가 같이 떠요. 더 필요하면 서버를 여러 대로(로드 밸런서 + EC2 여러 대) 늘려야 해요.
        </>,
        <>
          초당 요청 수 같은 넉넉한 한도(<code>SlidingWindowLimit</code>)는 계산대마다 따로 세서
          사실상 2배예요. 엄격하게 하려면 Redis <code>INCR</code> + <code>EXPIRE</code>로 옮겨야
          하는데, 요청마다 Redis 왕복이 하나 늘어요.
        </>,
        <>
          Node <code>cluster</code>로 한 컨테이너 안에서 코어 2개를 쓰는 방법도 있지만, 컨테이너를
          둘로 나누면 한쪽이 죽어도 다른 쪽이 받고, Caddy 헬스 체크로 빼낼 수 있어서 이쪽을
          골랐어요.
        </>,
      ],
    },
    {
      title: '개발자 도구로 보면',
      items: [
        <>
          Network 탭에서 <code>/health</code> 응답 헤더의 <code>x-instance-id</code>를 보세요.
          로컬에선 <code>local</code>이에요.
        </>,
      ],
    },
  ],
  links: [
    {
      label: 'docker-compose.prod.yml',
      href: githubFile('docker-compose.prod.yml'),
      note: 'API 4개 정의',
    },
    {
      label: 'deploy/deploy.sh',
      href: githubFile('deploy/deploy.sh'),
      note: '두 개 다 건강해야 전환',
    },
    {
      label: 'aggregation.service.ts',
      href: githubFile('apps/api/src/events/lib/aggregation.service.ts'),
      note: 'cron 잠금',
    },
    {
      label: 'usage-limits.service.ts',
      href: githubFile('apps/api/src/common/rate-limit/usage-limits.service.ts'),
      note: '실험은 한 번에 하나 (Redis)',
    },
    { label: 'docs/decisions.md', href: githubFile('docs/decisions.md'), note: '왜 이렇게 했는지' },
  ],
};
