'use client';

import { memo, useEffect, useState } from 'react';
import { GITHUB_URL } from '../../lib/site';
import { DevDetails, ResultNumbers } from '../components/ui';
import ui from '../components/ui.module.css';
import styles from './coupon.module.css';
import {
  DEFAULT_USERS,
  FIX_ANALOGY,
  QUANTITY,
  RECORDED_RUN_URL,
  type RecordedRun,
  replayStateAt,
  runSimulation,
} from './simulation';
import StrategyLab from './StrategyLab';
import type { Result, Strategy } from './types';
import { useReplay } from '../components/useReplay';

const FIXES = ['pessimistic', 'optimistic', 'atomic'] as const;
const BENCHMARK_URL = `${GITHUB_URL}/blob/main/docs/benchmarks/stage3-coupon.md`;

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}초`;

export default function TicketingDemo() {
  const [recorded, setRecorded] = useState<RecordedRun | null>(null);
  const [results, setResults] = useState<Partial<Record<Strategy, Result>>>({});
  /** 방금 직접 실행한 전략 (나머지는 지난 기록) */
  const [liveStrategies, setLiveStrategies] = useState<Strategy[]>([]);
  const [runningStrategy, setRunningStrategy] = useState<Strategy | null>(null);
  const [error, setError] = useState<{ strategy: Strategy; message: string } | null>(null);

  useEffect(() => {
    fetch(RECORDED_RUN_URL)
      .then((response) => response.json() as Promise<RecordedRun>)
      .then((run) => {
        setRecorded(run);
        // 이미 직접 실행한 결과가 있으면 그걸 유지
        setResults((current) => ({
          ...Object.fromEntries(run.results.map((result) => [result.strategy, result])),
          ...current,
        }));
      })
      .catch(() => setRecorded(null));
  }, []);

  const mergeResults = (newResults: Result[]) => {
    setResults((current) => ({
      ...current,
      ...Object.fromEntries(newResults.map((result) => [result.strategy, result])),
    }));
    setLiveStrategies((current) => [
      ...new Set([...current, ...newResults.map((result) => result.strategy)]),
    ]);
  };

  const runLive = async (strategy: Strategy, onDone: () => void) => {
    setRunningStrategy(strategy);
    setError(null);
    try {
      mergeResults(await runSimulation({ users: DEFAULT_USERS, quantity: QUANTITY, strategy }));
      onDone();
    } catch (caught) {
      setError({ strategy, message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setRunningStrategy(null);
    }
  };

  const sourceLabel = (strategy: Strategy) =>
    liveStrategies.includes(strategy)
      ? '방금 직접 실행한 결과'
      : recorded
        ? `지난 실측 기록 (${recorded.recordedAt}, 로컬 MySQL)`
        : '기록 불러오는 중…';

  return (
    <>
      <OversellStage
        result={results.none ?? null}
        sourceLabel={sourceLabel('none')}
        isRunning={runningStrategy === 'none'}
        isBlocked={runningStrategy !== null}
        error={error?.strategy === 'none' ? error.message : null}
        onRun={(onDone) => void runLive('none', onDone)}
      />

      <section className={ui.wide}>
        <div className={ui.column}>
          <h2 className={ui.sectionTitle}>고치는 방법 세 가지</h2>
          <p className={ui.lead}>
            같은 조건(100석, 500명 동시)에서 세 가지 방법을 실제로 돌린 결과예요. 셋 다 자리 없이
            들어온 사람은 0명이지만, 걸리는 시간과 수고가 달라요.
          </p>
        </div>
        <div className={ui.fixes}>
          {FIXES.map((strategy) => (
            <FixColumn
              key={strategy}
              strategy={strategy}
              result={results[strategy] ?? null}
              sourceLabel={sourceLabel(strategy)}
              isRunning={runningStrategy === strategy}
              isBlocked={runningStrategy !== null}
              error={error?.strategy === strategy ? error.message : null}
              onRun={(onDone) => void runLive(strategy, onDone)}
            />
          ))}
        </div>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>숫자로 본 결과</h2>
        <ResultNumbers
          items={[
            {
              value: '400명 → 0명',
              tone: 'good',
              label: '자리 없이 들어온 사람',
              detail: '100석에 500명. 고치기 전엔 400명이 더 들어왔고, 세 방법 모두 0명.',
            },
            {
              value: '약 4배',
              label: '"한 번에 처리"가 "줄 세우기"보다 빠름',
              detail: '0.41초 vs 1.70초 (각 3회 측정의 중간값)',
            },
            {
              value: '14,140번',
              tone: 'fail',
              label: '"눈치 보고 재도전"의 다시 시도 횟수',
              detail:
                '사람이 한꺼번에 몰리면 대부분 부딪혀요. 30번 넘게 실패한 440명은 자리가 남았는데도 못 샀어요 (100석 중 60석만 팔림).',
            },
          ]}
          source={
            <>
              출처: <a href={BENCHMARK_URL}>docs/benchmarks/stage3-coupon.md</a> — 맥북(M1 Pro) 한
              대에서 Docker MySQL로 측정. 같은 기계에서 서버·DB를 함께 돌린 상대 비교라 실행마다
              ±30% 정도 흔들려요. 위 그림의 재생 기록은 다른 날·다른 DB 설정이라 시간이 다를 수
              있어요(예: 그 기록에선 재도전이 9,015번 만에 모두 성공).
            </>
          }
        />
      </section>

      <section className={ui.wide}>
        <DevDetails description="전략별 SQL, DB 상태 변화 차트, 요청 500개 기록, 실제 DB 행 확인">
          <div className={ui.devIntro}>
            <p>
              버튼은 <code>POST /coupons/simulate</code>를 호출해요. 서버(NestJS + Prisma)가 MySQL에
              동시 요청을 던지고, 요청마다 시작·끝 시각, 재시도, 락 대기 시간을 기록해 돌려줘요.
              화면은 그 실측 타임라인을 2.5~6초로 늘여 재생한 거예요. 별도
              커넥션(connection_limit=1)이 약 25ms마다 실제 행을 읽은 스냅숏도 함께 와요.
            </p>
            <p>
              비유 ↔ 용어: 줄 세우기 = 비관적 락(<code>SELECT … FOR UPDATE</code>), 눈치 보고 재도전
              = 낙관적 락(version 비교 후 재시도, 최대 30회), 한 번에 처리 = 원자적 조건부{' '}
              <code>UPDATE … WHERE issuedCount &lt; totalQuantity</code>.
            </p>
            <p>
              코드:{' '}
              <a href={`${GITHUB_URL}/blob/main/apps/api/src/coupons/lib/coupon-strategies.ts`}>
                coupon-strategies.ts
              </a>{' '}
              · 검증 테스트:{' '}
              <a
                href={`${GITHUB_URL}/blob/main/apps/api/src/coupons/test/coupon-strategies.spec.ts`}
              >
                coupon-strategies.spec.ts
              </a>{' '}
              (실제 MySQL에서 300명 vs 50장: 제어 없음은 초과 발급, 나머지 셋은 정확히 50장) · 남용
              방지: 실행 후 서버 전체 3초 쿨다운, 동시 실행 1개, IP당 10초에 6번.
            </p>
          </div>
          <StrategyLab results={results} onResults={mergeResults} />
        </DevDetails>
      </section>
    </>
  );
}

type RunProps = {
  result: Result | null;
  sourceLabel: string;
  isRunning: boolean;
  isBlocked: boolean;
  error: string | null;
  onRun: (onDone: () => void) => void;
};

function OversellStage({ result, sourceLabel, isRunning, isBlocked, error, onRun }: RunProps) {
  const { elapsedMs, isDone, play } = useReplay(result);
  const state = result ? replayStateAt(result.requests, elapsedMs) : null;
  const seated = state ? state.issued - state.over : 0;
  const standing = state?.over ?? 0;
  return (
    <section className={ui.wide}>
      <div className={styles.stageLayout}>
        <SeatGrid seated={seated} standing={standing} showStanding />
        <div className={styles.stageSide}>
          <p className={ui.source}>{sourceLabel}</p>
          <dl className={styles.tally}>
            <div>
              <dt>앉은 사람</dt>
              <dd>
                {seated} <small>/ {QUANTITY}석</small>
              </dd>
            </div>
            <div className={standing > 0 ? styles.tallyFail : undefined}>
              <dt>자리 없이 들어온 사람</dt>
              <dd>{standing}명</dd>
            </div>
            {result && isDone && (
              <div>
                <dt>매표소 장부에 적힌 판매 수</dt>
                <dd>
                  {result.final.issuedCount}장{' '}
                  <small>(실제로 나간 표 {result.final.issueRows}장)</small>
                </dd>
              </div>
            )}
          </dl>
          <button
            type="button"
            className={ui.bigButton}
            onClick={() => onRun(play)}
            disabled={isBlocked}
          >
            {isRunning ? '500명이 예매하는 중…' : '500명 동시에 예매 시키기'}
          </button>
          {error ? (
            <p className={ui.errorLine} role="alert">
              {error}
            </p>
          ) : (
            <p className={ui.hint}>
              진짜 서버와 데이터베이스에서 500명의 예매가 동시에 일어나요. 1초도 안 걸려요.
            </p>
          )}
        </div>
      </div>
      {result && isDone && result.final.oversold > 0 && (
        <p className={ui.conclusion}>
          {QUANTITY}석에 {result.final.issueRows}명이 들어왔어요. 모두가 같은 순간에 &quot;자리
          있음&quot;을 봤기 때문이에요.
        </p>
      )}
    </section>
  );
}

function FixColumn({ strategy, ...props }: RunProps & { strategy: (typeof FIXES)[number] }) {
  const { result, sourceLabel, isRunning, isBlocked, error, onRun } = props;
  const { elapsedMs, isDone, play } = useReplay(result);
  const state = result ? replayStateAt(result.requests, elapsedMs) : null;
  const analogy = FIX_ANALOGY[strategy];
  return (
    <article className={ui.fix}>
      <h3>{analogy.title}</h3>
      <SeatGrid seated={state ? state.issued - state.over : 0} standing={state?.over ?? 0} />
      <p>{analogy.story}</p>
      {result && (
        <dl className={ui.fixStats}>
          <div>
            <dt>자리 없이 들어온 사람</dt>
            <dd className={result.final.oversold > 0 ? ui.failText : ui.goodText}>
              {isDone ? result.final.oversold : '…'}명
            </dd>
          </div>
          <div>
            <dt>걸린 시간</dt>
            <dd>{seconds(result.durationMs)}</dd>
          </div>
          {strategy === 'optimistic' && (
            <div>
              <dt>다시 시도한 횟수</dt>
              <dd>{(state?.retries ?? 0).toLocaleString()}번</dd>
            </div>
          )}
          {result.summary.retry_exhausted > 0 && (
            <div>
              <dt>자리가 남았는데 못 산 사람</dt>
              <dd className={ui.failText}>{result.summary.retry_exhausted}명</dd>
            </div>
          )}
        </dl>
      )}
      <p className={ui.tradeoff}>{analogy.tradeoff}</p>
      <p className={ui.source}>{sourceLabel}</p>
      {strategy === 'optimistic' && (
        <p className={ui.hint}>사람이 몰리면 수 초~20초 넘게 걸릴 수 있어요.</p>
      )}
      <button
        type="button"
        className={ui.smallButton}
        onClick={() => onRun(play)}
        disabled={isBlocked}
      >
        {isRunning ? '실행 중…' : '이 방법으로 직접 실행'}
      </button>
      {error && (
        <p className={ui.errorLine} role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

const SEAT_PITCH = 22;
const STANDING_COLUMNS = 20;
const STANDING_PITCH = 11;

/**
 * 공연장 좌석 100석(10×10)과, 자리 없이 들어온 사람이 서는 통로.
 * 움직이는 그림이라 손그림 필터를 걸지 않는다. 요소 수는 좌석 100 + 서 있는 사람 최대 400개로 상한.
 */
const SeatGrid = memo(function SeatGrid({
  seated,
  standing,
  showStanding = false,
}: {
  seated: number;
  standing: number;
  showStanding?: boolean;
}) {
  const visibleStanding = Math.min(standing, 400);
  return (
    <div className={showStanding ? styles.seatsWithStanding : styles.seatsOnly}>
      <svg
        viewBox="0 0 230 262"
        role="img"
        aria-label={`좌석 ${QUANTITY}석 중 ${seated}석에 사람이 앉음`}
      >
        <path d="M20 14 Q115 2 210 14" fill="none" stroke="#2b2620" strokeWidth="1.5" />
        <text x="115" y="30" textAnchor="middle" fontSize="14" fill="#5e564b">
          무대
        </text>
        {Array.from({ length: QUANTITY }, (_, index) => {
          const x = 6 + (index % 10) * SEAT_PITCH;
          const y = 38 + Math.floor(index / 10) * SEAT_PITCH;
          const isTaken = index < seated;
          return (
            <g key={index}>
              <rect
                x={x}
                y={y + 4}
                width="17"
                height="13"
                rx="3"
                fill={isTaken ? '#b4c9a9' : '#fbf8f2'}
                stroke="#2b2620"
                strokeWidth="1.1"
              />
              {isTaken && <circle cx={x + 8.5} cy={y + 4} r="3.6" fill="#2b2620" />}
            </g>
          );
        })}
      </svg>
      {showStanding && (
        <svg viewBox="0 0 230 262" role="img" aria-label={`자리 없이 들어온 사람 ${standing}명`}>
          <rect
            x="4"
            y="4"
            width="222"
            height="254"
            rx="10"
            fill="none"
            stroke="#b9ac95"
            strokeWidth="1.2"
            strokeDasharray="5 4"
          />
          <text
            x="115"
            y="24"
            textAnchor="middle"
            fontSize="14"
            fill={standing > 0 ? '#a3321f' : '#5e564b'}
          >
            {standing > 0 ? `자리 없이 들어온 사람 ${standing}명` : '통로 (원래 비어 있어야 해요)'}
          </text>
          {Array.from({ length: visibleStanding }, (_, index) => (
            <circle
              key={index}
              cx={11 + (index % STANDING_COLUMNS) * STANDING_PITCH}
              cy={38 + Math.floor(index / STANDING_COLUMNS) * STANDING_PITCH}
              r="3.8"
              fill="#a3321f"
            />
          ))}
        </svg>
      )}
    </div>
  );
});
