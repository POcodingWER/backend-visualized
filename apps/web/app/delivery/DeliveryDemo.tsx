'use client';

import { memo, useState } from 'react';
import { GITHUB_URL } from '../../lib/site';
import { DevDetails, ResultNumbers } from '../components/ui';
import ui from '../components/ui.module.css';
import Pipeline, {
  probeRateLimit,
  runDemoAggregate,
  sendEventsBothWays,
  type AggregateResult,
  type ProbeCounts,
  type SendResult,
} from './Pipeline';
import styles from './pipeline.module.css';

const PARCELS = 100;
const PROBE_TOTAL = 210;
const RECORDED_AT = '2026-10-19';
const BENCHMARK_URL = `${GITHUB_URL}/blob/main/docs/benchmarks/stage2-ingest.md`;
const INK = '#2b2620';

/** 지난 실측 기록: 로컬 API에 클릭 100개를 두 방식으로 보낸 결과 (첫 화면을 빈 상태 없이) */
const RECORDED_SEND: { single: SendResult; batch: SendResult } = {
  single: { requests: 100, ms: 123.1, rejected: 0 },
  batch: { requests: 1, ms: 25.7, rejected: 0 },
};

const seconds = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}초`);

export default function DeliveryDemo() {
  return (
    <>
      <TruckStage />
      <GateLimit />
      <DailyLedger />
      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>숫자로 본 결과</h2>
        <ResultNumbers
          items={[
            {
              value: '65배',
              tone: 'good',
              label: '묶어 보내기가 하나씩 보내기보다 빠름',
              detail: '클릭 기록 10,000개를 서버로: 18.7초 → 0.29초 (요청 10,000번 → 100번)',
            },
            {
              value: '58~72배',
              label: '묶어 저장하기가 하나씩 저장하기보다 빠름',
              detail: '데이터베이스에 10,000줄: 70.4초 → 1.21초 (두 번 측정)',
            },
            {
              value: '200 / 210',
              tone: 'fail',
              label: '게이트를 통과한 트럭',
              detail: `10초 안에 ${PROBE_TOTAL}대를 몰아 보내면 200대만 들어가고 10대는 돌려보냈어요 (${RECORDED_AT} 로컬 실측).`,
            },
          ]}
          source={
            <>
              출처: <a href={BENCHMARK_URL}>docs/benchmarks/stage2-ingest.md</a> — 맥북(M1 Pro) 한
              대에서 Docker MySQL로 측정한 상대 비교라 실행마다 ±30% 정도 흔들려요. 위 그림의
              100개짜리 기록은 양이 적어서 차이가 덜 보여요.
            </>
          }
        />
      </section>
      <section className={ui.wide}>
        <DevDetails description="7단계 파이프라인(SDK 큐 → API → MySQL → 집계 → SSE), 요청 기록, 단건 vs 배치 실험, 일별 집계 차트">
          <div className={ui.devIntro}>
            <p>
              비유 ↔ 용어: 택배 상자 = 이벤트 1개, 트럭 = HTTP 요청, 물류센터 = 브라우저 SDK의
              메모리 큐(10개 또는 10초마다 전송), 묶음배송 = <code>POST /events/batch</code>
              (1~100개) + Prisma <code>createMany</code>(INSERT 한 문장·한 커밋), 게이트 =
              ThrottlerGuard(IP당 10초 200요청 → 429), 저녁 장부 정리 = 5분마다 도는 일별 롤업 잡(
              <code>EventDailyStat</code> upsert).
            </p>
            <p>
              코드: <a href={`${GITHUB_URL}/tree/main/packages/sdk/src`}>packages/sdk</a> ·{' '}
              <a href={`${GITHUB_URL}/tree/main/apps/api/src/events`}>apps/api/src/events</a> · 측정
              스크립트:{' '}
              <a href={`${GITHUB_URL}/blob/main/apps/api/scripts/bench-ingest.ts`}>
                bench-ingest.ts
              </a>
              . 한계: 배치는 한 문장이라 일부만 실패해도 100개가 함께 실패하고, SDK가 배치 단위로
              다시 보내요.
            </p>
          </div>
          <Pipeline />
        </DevDetails>
      </section>
    </>
  );
}

/** 큰 버튼: 클릭 100개를 하나씩(트럭 100대) / 묶어서(트럭 1대) 실제로 보낸다 */
function TruckStage() {
  const [result, setResult] = useState(RECORDED_SEND);
  const [isLive, setIsLive] = useState(false);
  const [progress, setProgress] = useState<{ single: number; batch: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isRunning = progress !== null;

  const run = async () => {
    setError(null);
    setProgress({ single: 0, batch: 0 });
    try {
      // ponytail: 진행 표시는 100ms마다만 갱신 (트럭 100대 → setState 최대 10번/초)
      let lastShownAt = 0;
      const sent = await sendEventsBothWays(PARCELS, {
        onSingleProgress: (done) => {
          if (performance.now() - lastShownAt < 100 && done < PARCELS) return;
          lastShownAt = performance.now();
          setProgress({ single: done, batch: 0 });
        },
        onBatchProgress: (done) => setProgress({ single: PARCELS, batch: done }),
      });
      setResult(sent);
      setIsLive(true);
      if (sent.single.rejected > 0)
        setError(
          `게이트 인원 제한에 걸려 트럭 ${sent.single.rejected}대가 돌아갔어요 (10초에 200대까지). 10초쯤 뒤에 다시 눌러 주세요.`,
        );
    } catch {
      setError('서버에 연결하지 못했어요. 잠시 후 다시 눌러 주세요.');
    } finally {
      setProgress(null);
    }
  };

  const singleArrived = progress
    ? progress.single
    : result.single.requests - result.single.rejected;
  const batchArrived = progress ? progress.batch : result.batch.requests - result.batch.rejected;
  const speedup = result.single.ms / Math.max(1, result.batch.ms);
  return (
    <section className={ui.wide}>
      <div className={styles.truckStage}>
        <div className={styles.truckLanes}>
          <div>
            <p className={styles.laneTitle}>
              <b>하나씩 보내기</b> · 트럭 {result.single.requests}대 ·{' '}
              {isRunning ? '보내는 중…' : seconds(result.single.ms)}
            </p>
            <TruckGrid total={PARCELS} arrived={singleArrived} />
          </div>
          <div>
            <p className={styles.laneTitle}>
              <b>묶어서 보내기</b> · 트럭 {result.batch.requests}대 ·{' '}
              {isRunning && progress.batch === 0 ? '기다리는 중…' : seconds(result.batch.ms)}
            </p>
            <BigTruck arrived={batchArrived > 0} />
          </div>
        </div>
        <div className={styles.truckSide}>
          <p className={ui.source}>
            {isLive ? '방금 직접 보낸 결과' : `지난 실측 기록 (${RECORDED_AT}, 로컬 MySQL)`}
          </p>
          <p className={styles.bigNumber}>65배</p>
          <p className={styles.bigNumberLabel}>
            클릭 기록 10,000개를 묶어 보냈을 때 빨라진 정도 (18.7초 → 0.29초,{' '}
            <a href={BENCHMARK_URL}>측정 기록</a>)
          </p>
          <button
            type="button"
            className={ui.bigButton}
            onClick={() => void run()}
            disabled={isRunning}
          >
            {isRunning ? '트럭이 달리는 중…' : `클릭 ${PARCELS}개 두 가지로 보내기`}
          </button>
          {error ? (
            <p className={ui.errorLine} role="alert">
              {error}
            </p>
          ) : (
            <p className={ui.hint}>
              진짜 서버로 클릭 기록 {PARCELS}개를 하나씩 한 번, 묶어서 한 번 보내요. 데이터베이스에
              실제로 저장돼요.
            </p>
          )}
        </div>
      </div>
      {!isRunning && (
        <p className={`${ui.conclusion} ${ui.conclusionGood}`}>
          같은 {PARCELS}개를 옮기는 데 트럭 {result.single.requests}대와 {result.batch.requests}대.
          이번엔 묶어서 보낸 쪽이 {speedup.toFixed(1)}배 빨랐어요. 양이 많을수록 차이가 커져서,
          10,000개면 65배예요.
        </p>
      )}
    </section>
  );
}

/** 상자 하나에 트럭 하나: 10×10. 도착한 트럭은 채워진다. 움직이는 그림이라 필터 없음 */
const TruckGrid = memo(function TruckGrid({ total, arrived }: { total: number; arrived: number }) {
  return (
    <svg
      viewBox="0 0 300 160"
      className={styles.truckSvg}
      role="img"
      aria-label={`트럭 ${total}대 중 ${arrived}대 도착`}
    >
      {Array.from({ length: total }, (_, index) => {
        const x = 4 + (index % 10) * 29.5;
        const y = 4 + Math.floor(index / 10) * 15.5;
        const isArrived = index < arrived;
        return (
          <g key={index}>
            <rect
              x={x}
              y={y}
              width="17"
              height="9"
              rx="1.5"
              fill={isArrived ? '#f2c7a2' : '#fbf8f2'}
              stroke={INK}
              strokeWidth="1"
            />
            <rect
              x={x + 17}
              y={y + 3}
              width="6"
              height="6"
              rx="1"
              fill={isArrived ? '#f2c7a2' : '#fbf8f2'}
              stroke={INK}
              strokeWidth="1"
            />
            <circle cx={x + 5} cy={y + 11} r="1.8" fill={INK} />
            <circle cx={x + 19} cy={y + 11} r="1.8" fill={INK} />
          </g>
        );
      })}
    </svg>
  );
});

/** 상자 100개를 실은 트럭 한 대 */
function BigTruck({ arrived }: { arrived: boolean }) {
  return (
    <svg
      viewBox="0 0 300 120"
      className={`${styles.truckSvg} ${styles.bigTruck}`}
      role="img"
      aria-label={arrived ? '상자 100개를 실은 트럭 한 대 도착' : '트럭 한 대가 기다리는 중'}
    >
      <g filter="url(#hand-wobble)">
        <rect
          x="20"
          y="14"
          width="190"
          height="76"
          rx="6"
          fill={arrived ? '#b4c9a9' : '#fbf8f2'}
          stroke={INK}
          strokeWidth="2.2"
        />
        <path
          d="M210 40 h44 l26 26 v24 h-70 z"
          fill={arrived ? '#b4c9a9' : '#fbf8f2'}
          stroke={INK}
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <circle cx="62" cy="96" r="12" fill="#fbf8f2" stroke={INK} strokeWidth="2.2" />
        <circle cx="240" cy="96" r="12" fill="#fbf8f2" stroke={INK} strokeWidth="2.2" />
      </g>
      {Array.from({ length: 30 }, (_, index) => (
        <rect
          key={index}
          x={30 + (index % 10) * 17.5}
          y={22 + Math.floor(index / 10) * 20}
          width="13"
          height="14"
          rx="1.5"
          fill="#f2c7a2"
          stroke={INK}
          strokeWidth="1"
        />
      ))}
      <text x="115" y="112" textAnchor="middle" fontSize="13" fill={INK}>
        상자 100개
      </text>
    </svg>
  );
}

/** 게이트 인원 제한: DB에 쓰지 않는 체험용 엔드포인트로 210개를 몰아 보낸다 */
function GateLimit() {
  const [counts, setCounts] = useState<ProbeCounts | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const run = async () => {
    setIsRunning(true);
    let lastShownAt = 0;
    const final = await probeRateLimit(PROBE_TOTAL, (latest) => {
      if (performance.now() - lastShownAt < 100) return;
      lastShownAt = performance.now();
      setCounts({ ...latest });
    });
    setCounts(final);
    setIsRunning(false);
  };
  return (
    <section className={ui.column}>
      <h2 className={ui.sectionTitle}>게이트 인원 제한</h2>
      <p className={ui.lead}>
        물류센터 게이트는 한 곳에서 오는 트럭을 10초에 200대까지만 들여보내요. 누가 트럭을 한꺼번에
        쏟아부어도 창고(데이터베이스)가 멈추지 않게요. 돌려보낸 묶음은 브라우저가 버리지 않고
        보관했다가 다시 보내요.
      </p>
      <div className={styles.gateRow}>
        {counts && (
          <>
            <div>
              <p className={styles.gateNumber}>{counts.ok}</p>
              <p className={ui.source}>통과</p>
            </div>
            <div>
              <p className={`${styles.gateNumber} ${counts.limited > 0 ? ui.failText : ''}`}>
                {counts.limited}
              </p>
              <p className={ui.source}>돌려보냄</p>
            </div>
          </>
        )}
        <button
          type="button"
          className={ui.smallButton}
          onClick={() => void run()}
          disabled={isRunning}
        >
          {isRunning ? '보내는 중…' : `트럭 ${PROBE_TOTAL}대 한꺼번에 보내기`}
        </button>
      </div>
      <p className={ui.hint}>
        체험용 트럭은 빈 트럭이라 데이터베이스에 아무것도 남기지 않아요.
        {counts?.other ? ` (연결 오류 ${counts.other}대)` : ''}
        {counts && counts.limited === PROBE_TOTAL
          ? ' 지금은 다른 사람도 많이 눌러서 전부 돌아갔어요. 1분쯤 뒤에 다시 해 보세요.'
          : ''}
      </p>
    </section>
  );
}

/** 매일 저녁 장부 정리: 일별 롤업을 지금 한 번 돌린다 */
function DailyLedger() {
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const describe = (result: AggregateResult) =>
    `${result.from} ~ ${result.to}(한국 날짜) 장부를 다시 정리했어요: 이벤트 종류·날짜별로 ${result.rows}줄, ${result.ms}ms.`;
  const run = async () => {
    setIsRunning(true);
    const outcome = await runDemoAggregate();
    if ('result' in outcome) setMessage({ text: describe(outcome.result), ok: true });
    else if ('retryAfterSeconds' in outcome)
      setMessage({
        text: `방금 누가 정리했어요. ${outcome.retryAfterSeconds ?? '몇'}초 뒤에 다시 눌러 주세요.`,
        ok: false,
      });
    else setMessage({ text: '서버에 연결하지 못했어요.', ok: false });
    setIsRunning(false);
  };
  return (
    <section className={ui.column}>
      <h2 className={ui.sectionTitle}>매일 저녁 장부 정리</h2>
      <p className={ui.lead}>
        차트를 볼 때마다 창고의 상자를 하나하나 세면 느려요. 그래서 정해진 때마다(여기선 5분마다)
        &quot;날짜별·종류별 몇 개&quot;를 장부에 미리 적어 두고, 차트는 장부만 읽어요. 방금 보낸
        클릭은 다음 정리 뒤에 차트에 보여요.
      </p>
      <button
        type="button"
        className={ui.smallButton}
        onClick={() => void run()}
        disabled={isRunning}
      >
        {isRunning ? '정리하는 중…' : '지금 장부 정리하기'}
      </button>
      {message && (
        <p className={`${ui.hint} ${message.ok ? ui.goodText : ui.failText}`}>{message.text}</p>
      )}
    </section>
  );
}
