'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { seconds } from '../../lib/format';
import flow from '../components/flow.module.css';
import { DevDetails } from '../components/molecules/DevDetails';
import { DevFlow } from '../components/molecules/DevFlow';
import { ResultNumbers } from '../components/molecules/ResultNumbers';
import ui from '../components/ui.module.css';
import { useReplay } from '../../lib/useReplay';
import { Button } from '../components/atoms/Button';
import { Conclusion } from '../components/atoms/Conclusion';
import {
  loadWalletEntries,
  simulatePoints,
  type EntriesResponse,
  type PointMode,
  type PointSimulationResult,
} from './api';
import { LEDGER_DEV_FLOW } from './dev-flow';
import { explainLostUpdate } from './lost-update';

const MODES: PointMode[] = ['overwrite', 'ledger'];
type Results = Record<PointMode, PointSimulationResult>;
const RECORDED_RUN_URL = '/data/ledger-recorded-run.json';
const MODE_TITLE: Record<PointMode, string> = {
  overwrite: '잔액 숫자만 고치기',
  ledger: '통장처럼 내역 남기기',
};
const points = (value: number) => `${value.toLocaleString('ko-KR')}P`;

const toResults = (list: PointSimulationResult[]) =>
  Object.fromEntries(list.map((result) => [result.mode, result])) as Results;

export default function LedgerDemo() {
  const [results, setResults] = useState<Results | null>(null);
  const [recordedAt, setRecordedAt] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playCount, setPlayCount] = useState(0);
  const [entries, setEntries] = useState<Partial<Record<PointMode, EntriesResponse>>>({});

  useEffect(() => {
    fetch(RECORDED_RUN_URL)
      .then(
        (response) =>
          response.json() as Promise<{ recordedAt: string; results: PointSimulationResult[] }>,
      )
      .then((run) => {
        setRecordedAt(run.recordedAt);
        setResults((current) => current ?? toResults(run.results));
      })
      .catch(() => setRecordedAt(null));
  }, []);

  const loadEntries = async () => {
    const loaded = await Promise.all(
      MODES.map(async (mode) => {
        return [mode, await loadWalletEntries(mode, 8)] as const;
      }),
    );
    setEntries(Object.fromEntries(loaded));
  };

  const run = async () => {
    setIsRunning(true);
    setError(null);
    try {
      setResults(toResults(await simulatePoints(200)));
      setIsLive(true);
      setPlayCount((count) => count + 1);
      void loadEntries().catch(() => undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '서버에 연결하지 못했어요.');
    } finally {
      setIsRunning(false);
    }
  };

  const sourceLabel = isLive
    ? '방금 실제 서버에서 실행한 결과'
    : recordedAt
      ? `지난 실측 기록 (${recordedAt}, 로컬 MySQL)`
      : '기록 불러오는 중…';

  return (
    <>
      <LedgerStage
        results={results}
        sourceLabel={sourceLabel}
        isRunning={isRunning}
        error={error}
        playCount={playCount}
        onRun={() => void run()}
      />
      <WhyNotSection results={results} />
      <ReconcileSection results={results} entries={entries} onRecheck={loadEntries} />
      <OverdraftSection result={results?.ledger ?? null} sourceLabel={sourceLabel} />
      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>숫자로 본 결과</h2>
        <ResultNumbers
          items={[
            {
              value: results ? points(results.overwrite.lostPoints) : '…',
              tone: 'fail',
              label: '잔액 숫자만 고칠 때 사라진 포인트',
              detail:
                '적립 150건(+100P)·사용 50건(−100P)을 동시에. 내역 합계와 잔액 칸이 이만큼 어긋났어요.',
            },
            {
              value: results ? points(results.ledger.reconciliation.difference) : '…',
              tone: 'good',
              label: '통장 방식에서 어긋난 포인트 (잔액 − 내역 합계)',
              detail: results
                ? `같은 200건. 대신 한 명씩 차례로 처리해서 ${seconds(results.overwrite.durationMs)} → ${seconds(results.ledger.durationMs)}로 느려졌어요.`
                : undefined,
            },
            {
              value: results?.ledger.overdraft?.rejected ? '거절' : '…',
              label: '잔액보다 많이 쓰려고 하면',
              detail: results?.ledger.overdraft
                ? `잔액 ${points(results.ledger.reconciliation.balance)}에서 ${points(results.ledger.overdraft.attemptedAmount)} 사용 시도`
                : undefined,
            },
          ]}
          source={
            <>
              {sourceLabel}. 로컬 API(NestJS) + MySQL 8.4, 맥북 한 대에서 잰 값이라 실행마다
              사라지는 양이 달라요.
              {!isLive && (
                <>
                  {' '}
                  기록 파일: <a href={RECORDED_RUN_URL}>ledger-recorded-run.json</a>
                </>
              )}
            </>
          }
        />
      </section>
      <section className={ui.wide}>
        <DevDetails description="lost update, read-modify-write, SELECT … FOR UPDATE, append-only 원장, 대사(reconciliation), 실제 DB 행">
          <DevFlow content={LEDGER_DEV_FLOW} />
          <pre className={ui.source} style={{ overflowX: 'auto', margin: 0 }}>
            {`-- 통장 방식 (한 트랜잭션)
SELECT balance FROM PointWallet WHERE name = ? FOR UPDATE;  -- 다른 요청은 여기서 대기
-- balance + amount < 0 이면 거절
INSERT INTO PointEntry (walletName, amount, reason) VALUES (?, ?, ?);
UPDATE PointWallet SET balance = balance + ? WHERE name = ?;
COMMIT;

-- 대사
SELECT w.balance, (SELECT SUM(amount) FROM PointEntry e WHERE e.walletName = w.name) AS entriesSum
FROM PointWallet w WHERE w.name = ?;`}
          </pre>
          <EntriesTables entries={entries} onLoad={loadEntries} />
        </DevDetails>
      </section>
    </>
  );
}

/** 큰 무대: 200건이 손님 → 서버 → 잔액 칸으로 날아가는 실제 타임라인 재생 */
function LedgerStage({
  results,
  sourceLabel,
  isRunning,
  error,
  playCount,
  onRun,
}: {
  results: Results | null;
  sourceLabel: string;
  isRunning: boolean;
  error: string | null;
  playCount: number;
  onRun: () => void;
}) {
  const timeline = useMemo(
    () =>
      results
        ? { durationMs: Math.max(results.overwrite.durationMs, results.ledger.durationMs) }
        : null,
    [results],
  );
  const replay = useReplay(timeline);
  const { play } = replay;
  useEffect(() => {
    if (playCount > 0) play();
  }, [playCount]); // play는 매 렌더 새 함수라 playCount만 본다
  const lost = results?.overwrite.lostPoints ?? 0;

  return (
    <section className={ui.wide}>
      <div className={flow.stage}>
        <div className={flow.lanes}>
          {MODES.map((mode) => (
            <div key={mode}>
              <p className={flow.laneTitle}>
                {MODE_TITLE[mode]}{' '}
                <small>
                  {results
                    ? `· 실제로는 ${seconds(results[mode].durationMs)} 만에 끝난 일을 천천히 보여 줘요`
                    : ''}
                </small>
              </p>
              {results ? (
                <LedgerLane
                  result={results[mode]}
                  elapsedMs={replay.elapsedMs}
                  isDone={replay.isDone}
                />
              ) : (
                <div className={flow.flowSvg} style={{ aspectRatio: '480 / 210' }} />
              )}
            </div>
          ))}
        </div>
        <div className={flow.stageSide}>
          <p className={ui.source}>{sourceLabel}</p>
          <p className={`${flow.bigNumber} ${ui.failText}`}>{results ? points(lost) : '…'}</p>
          <p className={flow.bigNumberLabel}>잔액 숫자만 고쳤더니 사라진 포인트 (200건 동시에)</p>
          {results && (
            <p className={ui.hint}>
              있어야 할 잔액 <b>{points(results.overwrite.expectedBalance)}</b> → 실제로 남은 잔액{' '}
              <b className={ui.failText}>{points(results.overwrite.reconciliation.balance)}</b>.
              통장 방식은 같은 200건에서 <b className={ui.goodText}>0P</b> 사라졌어요.
            </p>
          )}
          <Button size="big" data-demo="적립·사용 200건" onClick={onRun} disabled={isRunning}>
            {isRunning ? '보내는 중…' : '적립·사용 200건 동시에 보내기'}
          </Button>
          <p className={ui.hint}>
            실제 서버와 데이터베이스에 보내요: 시작 5,000P에서 150명이 100P씩 적립, 50명이 100P씩
            사용, 모두 동시에. 하나도 빠짐없이 셌다면 5,000 + 15,000 − 5,000 = 15,000P예요.
          </p>
          {error && <p className={ui.errorLine}>{error}</p>}
        </div>
      </div>
      {results && (
        <Conclusion isGood={lost <= 0}>
          {lost > 0
            ? `있어야 할 잔액은 ${points(results.overwrite.expectedBalance)}(내역 합계도 ${points(results.overwrite.reconciliation.entriesSum)})인데 잔액 칸은 ${points(results.overwrite.reconciliation.balance)}. 같은 옛 잔액을 읽은 사람끼리 서로의 결과를 덮어써서 ${points(lost)}가 사라졌어요.`
            : '이번엔 덮어쓰기도 운 좋게 맞았어요. 다시 눌러 보세요 — 동시에 겹치면 언제든 사라져요.'}
        </Conclusion>
      )}
    </section>
  );
}

const GRID_COLUMNS = 20;
const SERVER = { x: 208, y: 105 };
const WALLET = { x: 380, y: 55 };
const homeOf = (index: number) => ({
  x: 18 + (index % GRID_COLUMNS) * 6,
  y: 44 + Math.floor(index / GRID_COLUMNS) * 13,
});

/** 쓰기 순서대로 잔액 칸 값을 따라간다 (덮어쓰기는 각자 계산한 값, 통장은 += amount) */
function useWriteHistory(result: PointSimulationResult) {
  return useMemo(() => {
    const writes = result.traces
      .filter((trace) => trace.outcome === 'applied')
      .sort((left, right) => left.wroteAtMs - right.wroteAtMs);
    let cell = result.openingBalance;
    return writes.map((trace) => {
      cell = result.mode === 'overwrite' ? trace.balanceWritten : cell + trace.amount;
      return { wroteAtMs: trace.wroteAtMs, cellAfter: cell, amount: trace.amount };
    });
  }, [result]);
}

const lerp = (from: number, to: number, ratio: number) => from + (to - from) * ratio;

const LedgerLane = memo(function LedgerLane({
  result,
  elapsedMs,
  isDone,
}: {
  result: PointSimulationResult;
  elapsedMs: number;
  isDone: boolean;
}) {
  const history = useWriteHistory(result);
  const written = history.filter((write) => write.wroteAtMs <= elapsedMs);
  // 끝난 뒤엔 DB에서 다시 센 실측값
  const cell = isDone
    ? result.reconciliation.balance
    : (written.at(-1)?.cellAfter ?? result.openingBalance);
  const entriesSum = isDone
    ? result.reconciliation.entriesSum
    : result.openingBalance + written.reduce((sum, write) => sum + write.amount, 0);
  const difference = cell - entriesSum;

  return (
    <svg
      className={flow.flowSvg}
      viewBox="0 0 480 210"
      role="img"
      aria-label={`${MODE_TITLE[result.mode]}: 잔액 칸 ${points(cell)}, 내역 합계 ${points(entriesSum)}`}
    >
      <text x="14" y="28" fontSize="14" fill="#5e564b">
        요청 {result.requests}건
      </text>
      {result.traces.map((_, index) => {
        const home = homeOf(index);
        return (
          <circle key={index} cx={home.x} cy={home.y} r="2.4" stroke="#d8cdba" strokeWidth="1" />
        );
      })}
      <rect
        x="168"
        y="72"
        width="80"
        height="66"
        rx="8"
        fill="#ede5d5"
        stroke="#2b2620"
        strokeWidth="1.8"
      />
      <text x={SERVER.x} y="110" textAnchor="middle" fontSize="16" fontWeight="700" fill="#2b2620">
        서버
      </text>
      <path
        d="M140 105 H164 M252 92 L286 60 M252 120 L286 148"
        stroke="#b9ac95"
        strokeWidth="1.5"
        strokeDasharray="4 5"
      />
      <rect
        x="290"
        y="16"
        width="180"
        height="82"
        rx="8"
        fill={difference !== 0 ? '#f2d3c8' : '#fbf8f2'}
        stroke="#2b2620"
        strokeWidth="1.8"
      />
      <text x="302" y="40" fontSize="14" fill="#5e564b">
        잔액 칸
      </text>
      <text
        x="302"
        y="80"
        fontSize="30"
        fontWeight="800"
        fill={difference !== 0 ? '#a3321f' : '#2b2620'}
      >
        {points(cell)}
      </text>
      <rect
        x="290"
        y="110"
        width="180"
        height="82"
        rx="8"
        fill="#fbf8f2"
        stroke="#2b2620"
        strokeWidth="1.8"
      />
      <text x="302" y="134" fontSize="14" fill="#5e564b">
        내역 합계
      </text>
      <text x="302" y="174" fontSize="30" fontWeight="800" fill="#44633d">
        {points(entriesSum)}
      </text>
      <text
        x="14"
        y="200"
        fontSize="14"
        fontWeight="700"
        fill={difference !== 0 ? '#a3321f' : '#44633d'}
      >
        {difference !== 0 ? `차이 ${points(difference)}` : '차이 0P'}
      </text>
      {result.traces.map((trace, index) => {
        if (trace.wroteAtMs <= elapsedMs || elapsedMs < trace.startedAtMs) return null;
        const home = homeOf(index);
        let position: { x: number; y: number };
        if (elapsedMs >= trace.readAtMs) {
          const ratio =
            (elapsedMs - trace.readAtMs) / Math.max(0.1, trace.wroteAtMs - trace.readAtMs);
          position = { x: lerp(SERVER.x, WALLET.x, ratio), y: lerp(SERVER.y, WALLET.y, ratio) };
        } else {
          const ratio =
            (elapsedMs - trace.startedAtMs) / Math.max(0.1, trace.readAtMs - trace.startedAtMs);
          position = { x: lerp(home.x, SERVER.x, ratio), y: lerp(home.y, SERVER.y, ratio) };
        }
        return (
          <circle
            key={index}
            cx={position.x}
            cy={position.y}
            r="3"
            fill={trace.amount > 0 ? '#44633d' : '#8e4f1f'}
          />
        );
      })}
    </svg>
  );
});

/** 비개발자용 설명: 두 명일 때 100P가 사라지는 걸 먼저 보이고, 같은 일을 200명으로 키운다 */
function WhyNotSection({ results }: { results: Results | null }) {
  const overwrite = results ? explainLostUpdate(results.overwrite) : null;
  const ledger = results ? explainLostUpdate(results.ledger) : null;
  const lastWriter = overwrite?.lastWriter;
  return (
    <section className={ui.wide}>
      <div className={ui.column}>
        <h2 className={ui.sectionTitle}>
          왜 {overwrite ? points(overwrite.shouldBe) : '15,000P'}가 아니라{' '}
          {overwrite ? points(overwrite.endedAt) : '…'}일까요?
        </h2>
        <p className={ui.lead}>
          <b>있어야 할 잔액</b>은 요청을 하나도 빠짐없이 셌을 때의 값이고, <b>실제로 남은 잔액</b>은
          끝나고 잔액 칸에 적혀 있던 값이에요. 잔액 숫자만 고치는 방식에선 여러 사람이 같은 순간에
          같은 옛 잔액을 읽고, 각자 계산한 값을 그 위에 덮어써요. 그래서 먼저 적은 사람의 몫이
          지워져요.
        </p>
      </div>
      <div className={`${ui.fixes} ${ui.fixesTwo}`}>
        <article className={ui.fix}>
          <h3>먼저 두 명만</h3>
          <TwoPeopleSketch />
          <ol className={ui.steps}>
            <li>가와 나가 동시에 잔액을 읽어요. 둘 다 5,000P를 봐요.</li>
            <li>가: 5,000 + 100 = 5,100P를 적어요.</li>
            <li>나: 5,000 + 100 = 5,100P를 적어요. 가가 적은 5,100P 위에 덮어써요.</li>
          </ol>
          <dl className={ui.fixStats}>
            <div>
              <dt>있어야 할 잔액</dt>
              <dd>5,000 + 100 + 100 = 5,200P</dd>
            </div>
            <div>
              <dt>실제로 남은 잔액</dt>
              <dd className={ui.failText}>5,100P</dd>
            </div>
            <div>
              <dt>사라진 포인트</dt>
              <dd className={ui.failText}>100P (가의 몫)</dd>
            </div>
          </dl>
        </article>
        <article className={ui.fix}>
          <h3>이제 {results?.overwrite.requests ?? 200}명</h3>
          {overwrite ? (
            <>
              <ol className={ui.steps}>
                <li>
                  시작 {points(overwrite.opening)}. {overwrite.earnCount}명이{' '}
                  {points(overwrite.pointsEach)}씩 적립하고, {overwrite.spendCount}명이{' '}
                  {points(overwrite.pointsEach)}씩 사용해요. 모두 동시에요.
                </li>
                <li>
                  {overwrite.readOpening === results!.overwrite.requests
                    ? `${overwrite.readOpening}명 모두가`
                    : `${results!.overwrite.requests}명 중 ${overwrite.readOpening}명이`}{' '}
                  같은 {points(overwrite.opening)}를 읽고, 거기에 자기 몫만 더하거나 빼서 적었어요.
                </li>
                {lastWriter && (
                  <li>
                    마지막에 적은 사람은 {lastWriter.amount > 0 ? '적립' : '사용'}이었어요:{' '}
                    {points(lastWriter.balanceSeen)} {lastWriter.amount > 0 ? '+' : '−'}{' '}
                    {points(Math.abs(lastWriter.amount))} = {points(lastWriter.balanceWritten)}. 그
                    앞의 몫은 전부 덮여서 사라졌어요.
                  </li>
                )}
              </ol>
              <dl className={ui.fixStats}>
                <div>
                  <dt>있어야 할 잔액</dt>
                  <dd>
                    {points(overwrite.opening)} + {points(overwrite.earned)} −{' '}
                    {points(overwrite.spent)} = {points(overwrite.shouldBe)}
                  </dd>
                </div>
                <div>
                  <dt>실제로 남은 잔액</dt>
                  <dd className={ui.failText}>{points(overwrite.endedAt)}</dd>
                </div>
                <div>
                  <dt>사라진 포인트</dt>
                  <dd className={ui.failText}>
                    {points(overwrite.shouldBe)} − {points(overwrite.endedAt)} ={' '}
                    {points(overwrite.lost)}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p>기록 불러오는 중…</p>
          )}
        </article>
      </div>
      {ledger && (
        <Conclusion isGood>
          통장 방식은 한 사람이 잔액을 읽고 적는 동안 다음 사람을 기다리게 해요(줄 서기). 그래서
          200명이 차례로 더해져 {points(ledger.endedAt)}, 사라진 포인트 {points(ledger.lost)}예요.
        </Conclusion>
      )}
    </section>
  );
}

/** 두 명이 같은 5,000P를 읽고 둘 다 5,100P를 적는 그림 */
function TwoPeopleSketch() {
  const row = (y: number, name: string, writeX: number) => (
    <g>
      <text x="8" y={y + 5} fontSize="15" fontWeight="800" fill="#2b2620">
        {name}
      </text>
      <rect
        x="34"
        y={y - 14}
        width="104"
        height="28"
        rx="6"
        fill="#bcd4e0"
        stroke="#2b2620"
        strokeWidth="1.5"
      />
      <text x="86" y={y + 5} textAnchor="middle" fontSize="13" fill="#2b2620">
        읽음 5,000P
      </text>
      <path
        d={`M140 ${y} H${writeX - 4}`}
        stroke="#b9ac95"
        strokeWidth="1.5"
        strokeDasharray="4 5"
      />
      <rect
        x={writeX}
        y={y - 14}
        width="120"
        height="28"
        rx="6"
        fill="#b4c9a9"
        stroke="#2b2620"
        strokeWidth="1.5"
      />
      <text x={writeX + 60} y={y + 5} textAnchor="middle" fontSize="13" fill="#2b2620">
        +100 → 5,100P 적음
      </text>
    </g>
  );
  return (
    <svg
      className={flow.flowSvg}
      viewBox="0 0 460 130"
      role="img"
      aria-label="가와 나가 둘 다 5,000P를 읽고 둘 다 5,100P를 적어서, 잔액 칸은 5,200P가 아니라 5,100P"
    >
      {row(30, '가', 160)}
      {row(86, '나', 196)}
      <rect
        x="352"
        y="22"
        width="100"
        height="72"
        rx="8"
        fill="#f2d3c8"
        stroke="#2b2620"
        strokeWidth="1.8"
      />
      <text x="402" y="44" textAnchor="middle" fontSize="12" fill="#5e564b">
        잔액 칸
      </text>
      <text x="402" y="74" textAnchor="middle" fontSize="20" fontWeight="800" fill="#a3321f">
        5,100P
      </text>
      <text x="402" y="116" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#a3321f">
        5,200P여야 해요
      </text>
    </svg>
  );
}

function ReconcileSection({
  results,
  entries,
  onRecheck,
}: {
  results: Results | null;
  entries: Partial<Record<PointMode, EntriesResponse>>;
  onRecheck: () => Promise<void>;
}) {
  const [isChecking, setIsChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recheck = async () => {
    setIsChecking(true);
    setError(null);
    try {
      await onRecheck();
      setCheckedAt(new Date().toLocaleTimeString('ko-KR', { hour12: false }));
    } catch {
      setError('서버에 연결하지 못했어요.');
    } finally {
      setIsChecking(false);
    }
  };
  return (
    <section className={ui.wide}>
      <div className={ui.column}>
        <h2 className={ui.sectionTitle}>내역이 있으면 언제든 다시 맞춰 볼 수 있어요</h2>
        <p className={ui.lead}>
          잔액 숫자만 있으면 틀려도 틀린 줄 몰라요. 입출금 내역을 한 줄씩 남겨 두면, 내역을 전부
          더한 값과 잔액 칸을 비교해서(회계 용어로 &apos;대사&apos;) 어긋남을 바로 잡아낼 수 있어요.
        </p>
      </div>
      <div className={`${ui.fixes} ${ui.fixesTwo}`}>
        {MODES.map((mode) => {
          const reconciliation =
            entries[mode]?.reconciliation ?? results?.[mode].reconciliation ?? null;
          const isOff = reconciliation ? reconciliation.difference !== 0 : false;
          return (
            <article key={mode} className={ui.fix}>
              <h3>{MODE_TITLE[mode]}</h3>
              <dl className={ui.fixStats}>
                <div>
                  <dt>잔액 칸</dt>
                  <dd>{reconciliation ? points(reconciliation.balance) : '…'}</dd>
                </div>
                <div>
                  <dt>내역 합계</dt>
                  <dd>{reconciliation ? points(reconciliation.entriesSum) : '…'}</dd>
                </div>
                <div>
                  <dt>차이</dt>
                  <dd className={isOff ? ui.failText : ui.goodText}>
                    {reconciliation
                      ? isOff
                        ? `${points(reconciliation.difference)} 어긋남`
                        : '0P · 맞음'
                      : '…'}
                  </dd>
                </div>
              </dl>
              <p className={ui.tradeoff}>
                {mode === 'overwrite'
                  ? '내역은 다 남았는데 잔액 칸만 틀렸어요. 대사가 없었다면 아무도 몰랐을 거예요.'
                  : '한 명씩 차례로 처리해서 조금 느리지만, 잔액과 내역이 언제나 같아요.'}
              </p>
            </article>
          );
        })}
      </div>
      <p style={{ marginTop: 'var(--space-6)' }}>
        <Button size="small" onClick={() => void recheck()} disabled={isChecking}>
          {isChecking ? '세는 중…' : '지금 데이터베이스에서 다시 맞춰 보기'}
        </Button>
      </p>
      <p className={ui.hint}>
        {checkedAt
          ? `${checkedAt}에 데이터베이스의 잔액 칸과 내역을 직접 다시 셌어요.`
          : '버튼을 누르면 마지막 실행의 잔액 칸과 내역 합계를 데이터베이스에서 직접 다시 세요.'}
      </p>
      {error && <p className={ui.errorLine}>{error}</p>}
    </section>
  );
}

function OverdraftSection({
  result,
  sourceLabel,
}: {
  result: PointSimulationResult | null;
  sourceLabel: string;
}) {
  return (
    <section className={ui.column}>
      <h2 className={ui.sectionTitle}>0원 밑으로는 못 써요</h2>
      <p className={ui.lead}>
        통장 방식은 잔액을 확인하는 순간부터 다 쓸 때까지 그 통장을 잠가요. 그래서 "잔액 확인 →
        사용" 사이에 다른 사용이 끼어들어 잔액이 마이너스가 되는 일이 없어요.
      </p>
      {result?.overdraft && (
        <Conclusion isGood style={{ marginTop: 0 }}>
          잔액 {points(result.reconciliation.balance)}에서{' '}
          {points(result.overdraft.attemptedAmount)}를 쓰려고 하자{' '}
          {result.overdraft.rejected ? '거절했어요' : '통과했어요(오류)'}. 내역도 잔액도 그대로예요.
        </Conclusion>
      )}
      <p className={ui.source}>{sourceLabel}</p>
    </section>
  );
}

function EntriesTables({
  entries,
  onLoad,
}: {
  entries: Partial<Record<PointMode, EntriesResponse>>;
  onLoad: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <p style={{ marginBottom: 'var(--space-3)' }}>
        <b>PointEntry 최근 행 (실제 DB)</b>{' '}
        <Button
          size="small"
          onClick={() => void onLoad().catch(() => setError('불러오지 못했어요'))}
        >
          불러오기
        </Button>
      </p>
      {error && <p className={ui.errorLine}>{error}</p>}
      <div className={`${ui.fixes} ${ui.fixesTwo}`}>
        {MODES.map((mode) => (
          <div key={mode} className={flow.tableScroll}>
            <p className={ui.source}>
              <code>{entries[mode]?.walletName ?? `sim-${mode}`}</code>
            </p>
            <table className={flow.dbTable}>
              <thead>
                <tr>
                  <th>id</th>
                  <th>amount</th>
                  <th>reason</th>
                  <th>createdAt</th>
                </tr>
              </thead>
              <tbody>
                {(entries[mode]?.entries ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.id}</td>
                    <td>{entry.amount > 0 ? `+${entry.amount}` : entry.amount}</td>
                    <td>{entry.reason}</td>
                    <td>
                      {new Date(entry.createdAt).toLocaleTimeString('ko-KR', {
                        hour12: false,
                        fractionalSecondDigits: 3,
                      })}
                    </td>
                  </tr>
                ))}
                {!entries[mode] && (
                  <tr>
                    <td colSpan={4}>아직 안 불러왔어요</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
