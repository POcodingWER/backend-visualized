import { ChapterLayout } from '../components/organisms/ChapterLayout';
import { ComicStrip } from '../components/organisms/ComicStrip';
import ScaleOutDemo from './ScaleOutDemo';
import { INK, inkStroke } from '../components/atoms/ink';

export const metadata = {
  title: '7장 스케일아웃: 계산대 하나 더 열기 — 버튼 하나 뒤에서',
};

function Counter({ x, y, busy = false }: { x: number; y: number; busy?: boolean }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="60"
        height="50"
        rx="4"
        fill={busy ? '#f2c7a2' : '#bcd4e0'}
        {...inkStroke}
      />
      <circle cx={x + 30} cy={y + 18} r="8" fill="#fbf8f2" {...inkStroke} strokeWidth="1.5" />
      <text x={x + 30} y={y + 40} textAnchor="middle" fontSize="11" fontWeight="600" fill={INK}>
        계산대
      </text>
    </g>
  );
}

function Customer({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="6" fill="#fbf8f2" {...inkStroke} strokeWidth="1.4" />
      <path
        d={`M${x - 8} ${y + 20} Q${x} ${y + 4} ${x + 8} ${y + 20}`}
        fill="#a8c99c"
        {...inkStroke}
        strokeWidth="1.4"
      />
    </g>
  );
}

const PANELS = [
  {
    caption: '계산대가 하나뿐이면, 손님이 몰릴 때 줄이 길어져요.',
    art: (
      <g>
        <Counter x={160} y={50} busy />
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Customer key={index} x={40 + (index % 3) * 30} y={50 + Math.floor(index / 3) * 45} />
        ))}
        <path d="M70 65 L155 65" {...inkStroke} strokeDasharray="3 3" />
      </g>
    ),
  },
  {
    caption: '계산대를 하나 더 열면, 같은 시간에 두 배 많은 손님을 받을 수 있어요.',
    art: (
      <g>
        <Counter x={40} y={50} />
        <Counter x={160} y={50} />
        {[0, 1, 2].map((index) => (
          <Customer key={index} x={30 + index * 30} y={120} />
        ))}
        {[0, 1, 2].map((index) => (
          <Customer key={`right-${index}`} x={150 + index * 30} y={120} />
        ))}
      </g>
    ),
  },
  {
    caption: '서버도 마찬가지예요. API 인스턴스 하나가 한계에 부딪히면, 인스턴스를 하나 더 띄워요.',
    art: (
      <g>
        <rect x={30} y={30} width="80" height="60" rx="6" fill="#bcd4e0" {...inkStroke} />
        <text x={70} y={50} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
          api-1
        </text>
        <text x={70} y={68} textAnchor="middle" fontSize="10" fill="#5e564b">
          100% CPU
        </text>
        <rect x={130} y={30} width="80" height="60" rx="6" fill="#bcd4e0" {...inkStroke} />
        <text x={170} y={50} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
          api-2
        </text>
        <text x={170} y={68} textAnchor="middle" fontSize="10" fill="#5e564b">
          50% CPU
        </text>
        <rect x={80} y={110} width="80" height="40" rx="6" fill="#f2d3c8" {...inkStroke} />
        <text x={120} y={135} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
          Caddy
        </text>
      </g>
    ),
  },
];

export default function ScaleOutPage() {
  return (
    <ChapterLayout
      chapterNumber={7}
      title="스케일아웃"
      question="한 계산대가 한계에 부딪히면?"
    >
      <ComicStrip label="계산대 하나 더 열기" panels={PANELS} />

      <section>
        <h2>병목: 한 프로세스가 CPU 코어 하나를 다 씀</h2>
        <p>
          2026-10-21 부하 테스트 결과 (<code>load/breakpoint.js</code>, 읽기 전용 GET /health +
          /events/stats, 맥 한 대에서 프로덕션으로):
        </p>
        <ul>
          <li>10 → 800 VU로 12분 동안 램프, 총 389,658 요청, 평균 ~541 req/s</li>
          <li>실패 0.89% (모두 10초 클라이언트 타임아웃, 500 에러 없음)</li>
          <li>중앙값 86ms, p95 2.64초, p99 7.22초</li>
          <li>
            처리량은 100 VU (~620 req/s) 근처에서 정체: VU별 p95가 10=90ms → 50=120ms → 100=460ms →
            200=1.3초 → 400=3.1초 → 800=7-10초
          </li>
          <li>
            API 컨테이너 CPU <code>docker stats</code>에서 100-120%, 인스턴스 CPU CloudWatch에서
            최대 90.1%
          </li>
          <li>MySQL은 14 커넥션 피크, Redis 정상, 재시작·OOM 없음</li>
        </ul>
        <p>
          <strong>결론:</strong> 한 Node.js 이벤트 루프가 CPU 코어 하나를 꽉 채웠어요. 서버는 2
          vCPU인데 1 코어만 썼어요.
        </p>
      </section>

      <section>
        <h2>해결: API 인스턴스를 2개로 늘리기</h2>
        <p>Docker Compose에서 한 색(blue/green)당 2개 인스턴스를 띄웠어요:</p>
        <ul>
          <li>
            <code>api_blue_1</code>, <code>api_blue_2</code> (또는 <code>api_green_1</code>,{' '}
            <code>api_green_2</code>)
          </li>
          <li>
            Caddy가 <code>least_conn</code> 정책으로 두 인스턴스에 로드 밸런싱 + 30초마다{' '}
            <code>/health</code> 확인
          </li>
          <li>무중단 배포는 그대로: 쉬던 색의 2개를 띄우고, 둘 다 건강하면 전환</li>
        </ul>
      </section>

      <section>
        <h2>실제 요청 확인: 어느 인스턴스가 응답했는지</h2>
        <ScaleOutDemo />
      </section>

      <section>
        <h2>스케일아웃하면 깨지는 것들</h2>

        <h3>1. 프로세스 메모리에 저장한 상태</h3>
        <p>
          레이트 리밋 카운터, 동시 실행 제한 같은 상태를 각 인스턴스 메모리에 저장하고 있었어요.
          인스턴스가 2개가 되면 한도도 2배가 돼요.
        </p>
        <details>
          <summary>
            <strong>처음엔</strong>
          </summary>
          <p>
            <code>apps/api/src/common/rate-limit/usage-limits.ts</code>에서{' '}
            <code>SlidingWindowLimit</code>, <code>Cooldown</code> 등이 <code>Map</code>과 변수로
            상태를 들고 있었어요. 주석에 "인스턴스를 여러 대로 늘리면 Redis로 옮겨야 한다"고
            써뒀어요.
          </p>
        </details>
        <details>
          <summary>
            <strong>실제로는</strong>
          </summary>
          <p>
            데모 사이트라 "한도가 2배"는 큰 문제가 아니었어요. 원래도 넉넉하게 잡았고, 공격을
            막으려는 게 아니라 DB 과부하를 피하려는 한도였어요.
          </p>
        </details>
        <details>
          <summary>
            <strong>그래서</strong>
          </summary>
          <p>
            일단 그대로 뒀어요. 파일 주석에 "각 인스턴스마다 별도 한도"라고 명시하고, 나중에
            필요하면 Redis 기반 레이트 리밋으로 교체할 수 있어요.
          </p>
          <p>
            <code>ponytail:</code> Redis로 옮기면 SET NX + INCR + EXPIRE로 전역 한도를 만들 수
            있어요. 하지만 네트워크 왕복이 추가되고, Redis 장애 시 fallback 로직도 필요해요. 지금은
            그 복잡도를 받아들이지 않았어요.
          </p>
        </details>

        <h3>2. Cron job이 모든 인스턴스에서 실행</h3>
        <p>
          <code>@nestjs/schedule</code>의 <code>@Cron</code> 데코레이터는 각 프로세스에서 독립적으로
          동작해요. 인스턴스가 2개면 같은 작업이 2번 돌아요.
        </p>
        <details>
          <summary>
            <strong>처음엔</strong>
          </summary>
          <p>
            5장 결제 정리 job(<code>closeStalePayments</code>)은 조건부 <code>UPDATE</code> (
            <code>status='processing' AND createdAt &lt; 기준</code>)라 두 인스턴스가 동시에 돌아도
            안전했어요. 한 행은 한 번만 바뀌고, 나머지 UPDATE는 조건에 안 맞아 0 row.
          </p>
          <p>
            하지만 3장 이벤트 집계 job(<code>aggregateRange</code>)은 멱등하지만 중복 작업이었어요.
            DB 리소스를 2배 쓸 이유가 없었어요.
          </p>
        </details>
        <details>
          <summary>
            <strong>실제로는</strong>
          </summary>
          <p>
            Redis <code>SET NX PX</code> (SET if Not eXists + 만료 시간)로 분산 락을 만들었어요. 두
            인스턴스가 동시에 SET을 시도하면 하나만 성공하고, 그 인스턴스만 작업을 실행해요.
          </p>
        </details>
        <details>
          <summary>
            <strong>그래서</strong>
          </summary>
          <p>
            <code>apps/api/src/events/lib/aggregation.service.ts</code>에 락 로직 추가:
          </p>
          <pre>
            <code>
              {`const lockToken = \`\${Date.now()}-\${Math.random()}\`;
acquired = await redis.set(LOCK_KEY, lockToken, 'PX', 60000, 'NX') === 'OK';
if (!acquired) return;
// 작업 실행
// 끝나면 내 토큰일 때만 DEL (다른 인스턴스가 락 뺏어가지 않도록)`}
            </code>
          </pre>
          <p>
            결제 정리 job은 이미 안전하므로 그대로 두고, 주석으로 "조건부 UPDATE라 중복 실행
            안전"이라고 설명했어요.
          </p>
        </details>

        <h3>3. Prisma 마이그레이션 동시 실행</h3>
        <p>
          두 인스턴스가 동시에 시작하면 <code>prisma migrate deploy</code>를 동시에 실행해요.
        </p>
        <details>
          <summary>
            <strong>실제로는</strong>
          </summary>
          <p>
            Prisma는 <code>_prisma_migrations</code> 테이블에 advisory lock을 사용해서 동시 실행을
            막아요. 하지만 불필요한 경쟁을 피하려고, 첫 번째 인스턴스(<code>api_*_1</code>)만
            마이그레이션을 실행하고 두 번째는 <code>RUN_MIGRATIONS=false</code>로 건너뛰게 했어요.
          </p>
        </details>
      </section>

      <section>
        <h2>정직한 한계</h2>
        <p>
          이 서버는 2 vCPU라 인스턴스 2개가 최대예요. 더 늘리려면 서버를 늘려야 해요 (ALB + 여러
          EC2, 또는 ECS 오토스케일링). 그리고 요청이 더 늘면 다음 병목은 DB가 될 거예요.
        </p>
        <p>
          <strong>k6 재측정 (배포 후 실측):</strong>
        </p>
        <details open>
          <summary>측정 예정</summary>
          <p>
            프로덕션 배포 후 같은 조건으로 부하 테스트를 다시 돌려서, p95/p99 지연시간과 처리량이
            얼마나 개선됐는지 여기에 채울 예정이에요.
          </p>
        </details>
      </section>
    </ChapterLayout>
  );
}
