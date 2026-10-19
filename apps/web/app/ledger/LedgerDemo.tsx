'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { API_URL } from '../../lib/api';
import { GITHUB_URL } from '../../lib/site';
import flow from '../components/flow.module.css';
import { DevDetails, ResultNumbers } from '../components/ui';
import ui from '../components/ui.module.css';
import { useReplay } from '../components/useReplay';

type PointMode = 'overwrite' | 'ledger';
const MODES: PointMode[] = ['overwrite', 'ledger'];

interface PointRequestTrace {
  amount: number;
  startedAtMs: number;
  readAtMs: number;
  wroteAtMs: number;
  balanceSeen: number;
  balanceWritten: number;
  outcome: 'applied' | 'rejected';
}
interface Reconciliation {
  balance: number;
  entriesSum: number;
  difference: number;
}
interface PointSimulationResult {
  mode: PointMode;
  walletName: string;
  requests: number;
  openingBalance: number;
  expectedBalance: number;
  reconciliation: Reconciliation;
  lostPoints: number;
  rejected: number;
  durationMs: number;
  traces: PointRequestTrace[];
  overdraft?: { attemptedAmount: number; rejected: boolean };
}
type Results = Record<PointMode, PointSimulationResult>;
interface EntriesResponse {
  walletName: string;
  reconciliation: Reconciliation | null;
  entries: { id: string; amount: number; reason: string; createdAt: string }[];
}

const RECORDED_RUN_URL = '/data/ledger-recorded-run.json';
const CODE_URL = `${GITHUB_URL}/blob/main/apps/api/src/points/point-ledger.ts`;
const DOCS_URL = `${GITHUB_URL}/blob/main/docs/chapters-4-6.md#4장-포인트-통장`;
const MODE_TITLE: Record<PointMode, string> = {
  overwrite: '잔액 숫자만 고치기',
  ledger: '통장처럼 내역 남기기',
};
const points = (value: number) => `${value.toLocaleString('ko-KR')}P`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}초`;

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
        const response = await fetch(`${API_URL}/points/${mode}/entries?limit=8`);
        return [mode, (await response.json()) as EntriesResponse] as const;
      }),
    );
    setEntries(Object.fromEntries(loaded));
  };

  const run = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/points/simulate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requests: 200 }),
      });
      if (response.status === 429 || response.status === 409)
        throw new Error('방금 누가 실행했어요. 몇 초 뒤에 다시 눌러 주세요.');
      if (!response.ok) throw new Error(`서버 오류 (${response.status})`);
      const body = (await response.json()) as { results: PointSimulationResult[] };
      setResults(toResults(body.results));
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
    ? '방금 실제 서버·DB에서 실행한 결과'
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
              label: '통장 방식의 잔액 − 내역 합계',
              detail: results
                ? `같은 200건. 대신 한 명씩 차례로 처리해서 ${seconds(results.overwrite.durationMs)} → ${seconds(results.ledger.durationMs)}로 느려졌어요.`
                : undefined,
            },
            {
              value: results?.ledger.overdraft?.rejected ? '거절' : '…',
              label: '잔액보다 많이 쓰기',
              detail: results?.ledger.overdraft
                ? `잔액 ${points(results.ledger.reconciliation.balance)}에서 ${points(results.ledger.overdraft.attemptedAmount)} 사용 시도`
                : undefined,
            },
          ]}
          source={
            <>
              {sourceLabel}. 로컬 API(NestJS) + MySQL 8.4, 맥북 한 대에서 잰 값이라 실행마다
              사라지는 양이 달라요. 기록 파일:{' '}
              <a href={RECORDED_RUN_URL}>ledger-recorded-run.json</a>
            </>
          }
        />
      </section>
      <section className={ui.wide}>
        <DevDetails description="lost update, read-modify-write, SELECT … FOR UPDATE, append-only 원장, 대사(reconciliation), 실제 DB 행">
          <div className={ui.devIntro}>
            <p>
              비유 ↔ 용어: 잔액 칸 = <code>PointWallet.balance</code>, 입출금 내역 ={' '}
              <code>PointEntry</code>(추가만 하는 원장, append-only), 덮어쓰기 = 애플리케이션에서
              읽고 계산해서 쓰는 read-modify-write → <b>lost update</b>, 통장 방식 = 한 트랜잭션에서{' '}
              <code>SELECT balance … FOR UPDATE</code>(행 잠금) → 0 미만 검사 →{' '}
              <code>INSERT PointEntry</code> → <code>UPDATE balance = balance + ?</code>, 맞춰 보기
              = 대사(reconciliation): <code>balance</code> vs <code>SUM(PointEntry.amount)</code>.
            </p>
            <p>
              덮어쓰기 쪽도 내역은 남겨서, 대사가 어긋남을 잡아내는 모습을 보여줘요. 실무에선 잔액
              칸을 아예 두지 않고 SUM으로만 계산하거나, 잔액은 캐시로 두고 매일 밤 대사 잡으로
              검증해요. 한계: 지갑 한 행을 잠그므로 한 사람에게 요청이 몰리면 줄이 길어져요(위 시간
              비교).
            </p>
            <p>
              코드: <a href={CODE_URL}>point-ledger.ts</a> · 문서:{' '}
              <a href={DOCS_URL}>docs/chapters-4-6.md</a>
            </p>
          </div>
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
                  {results ? `· 실제 ${seconds(results[mode].durationMs)} 걸린 일을 천천히` : ''}
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
          <p className={ui.hint}>
            통장 방식은 같은 200건에서 <b className={ui.goodText}>0P</b> 사라졌어요.
          </p>
          <button type="button" className={ui.bigButton} onClick={onRun} disabled={isRunning}>
            {isRunning ? '보내는 중…' : '적립·사용 200건 동시에 보내기'}
          </button>
          <p className={ui.hint}>
            진짜 서버와 데이터베이스에 적립(+100P) 150건, 사용(−100P) 50건을 한꺼번에 보내요. 시작
            잔액은 5,000P라 정상이라면 15,000P가 돼야 해요.
          </p>
          {error && <p className={ui.errorLine}>{error}</p>}
        </div>
      </div>
      {results && (
        <p className={`${ui.conclusion} ${lost > 0 ? '' : ui.conclusionGood}`}>
          {lost > 0
            ? `내역 합계는 ${points(results.overwrite.reconciliation.entriesSum)}인데 잔액 칸은 ${points(results.overwrite.reconciliation.balance)}. 동시에 읽은 사람끼리 서로의 몫을 덮어써서 ${points(lost)}가 사라졌어요.`
            : '이번엔 덮어쓰기도 운 좋게 맞았어요. 다시 눌러 보세요 — 동시에 겹치면 언제든 사라져요.'}
        </p>
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
          더한 값과 잔액 칸을 비교해서(대사) 어긋남을 바로 잡아낼 수 있어요.
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
        <button
          type="button"
          className={ui.smallButton}
          onClick={() => void recheck()}
          disabled={isChecking}
        >
          {isChecking ? '세는 중…' : '지금 데이터베이스에서 다시 맞춰 보기'}
        </button>
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
        <p className={`${ui.conclusion} ${ui.conclusionGood}`} style={{ marginTop: 0 }}>
          잔액 {points(result.reconciliation.balance)}에서{' '}
          {points(result.overdraft.attemptedAmount)}를 쓰려고 하자{' '}
          {result.overdraft.rejected ? '거절했어요' : '통과했어요(오류)'}. 내역도 잔액도 그대로예요.
        </p>
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
        <button
          type="button"
          className={ui.smallButton}
          onClick={() => void onLoad().catch(() => setError('불러오지 못했어요'))}
        >
          불러오기
        </button>
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
