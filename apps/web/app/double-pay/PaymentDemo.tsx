'use client';

import { useState, type CSSProperties } from 'react';
import flow from '../components/flow.module.css';
import { DevDetails } from '../components/molecules/DevDetails';
import { DevFlow } from '../components/molecules/DevFlow';
import { ResultNumbers } from '../components/molecules/ResultNumbers';
import ui from '../components/ui.module.css';
import { Button } from '../components/atoms/Button';
import { Conclusion } from '../components/atoms/Conclusion';
import { listPayments, pay, type PaymentRow } from './api';
import { DOUBLE_PAY_DEV_FLOW } from './dev-flow';

type AttemptState = 'sending' | 'gave_up' | 'charged' | 'replayed' | 'failed';
interface Attempt {
  label: string;
  state: AttemptState;
  paymentId?: number;
}

/** 한 번의 실험: 버튼 연타(clicks번, 90ms 간격) + 첫 요청이 늦으면 앱이 자동 재시도 */
interface Scenario {
  withKey: boolean;
  clicks: number;
}
interface ScenarioRun {
  attempts: Attempt[];
  rows: PaymentRow[];
  isDone: boolean;
}

const AMOUNT = 12_000;
const CLICK_GAP_MS = 90;
/** 앱이 응답을 기다리는 시간. 서버의 가짜 결제사 승인(0.9초)보다 짧아서 꼭 재시도가 일어난다 */
const CLIENT_TIMEOUT_MS = 600;
const POLL_MS = 200;
const RECORDED_AT = '2026-10-20';
const recordedRow = (
  id: number,
  createdAt: string,
  idempotencyKey: string | null = null,
): PaymentRow => ({
  id,
  orderId: 'order-recorded',
  amount: 12_000,
  status: 'paid',
  idempotencyKey,
  createdAt,
  paidAt: null,
});
/** 지난 실측 (2026-10-20 08:38 KST, 로컬 API + MySQL): 이 화면의 버튼을 그대로 눌렀을 때의 요청 결과와 결제 행 */
const RECORDED_RUNS: {
  withoutKey: ScenarioRun;
  withKey: ScenarioRun;
  buttonLockOnly: ScenarioRun;
} = {
  withoutKey: {
    attempts: [
      { label: '1번째 누름', state: 'gave_up' },
      { label: '2번째 누름', state: 'charged', paymentId: 31 },
      { label: '3번째 누름', state: 'charged', paymentId: 33 },
      { label: '앱이 자동 재시도', state: 'charged', paymentId: 35 },
    ],
    rows: [
      recordedRow(30, '2026-10-19T23:38:41.790Z'),
      recordedRow(31, '2026-10-19T23:38:41.877Z'),
      recordedRow(33, '2026-10-19T23:38:41.966Z'),
      recordedRow(35, '2026-10-19T23:38:42.396Z'),
    ],
    isDone: true,
  },
  withKey: {
    attempts: [
      { label: '1번째 누름', state: 'gave_up' },
      { label: '2번째 누름', state: 'replayed', paymentId: 29 },
      { label: '3번째 누름', state: 'replayed', paymentId: 29 },
      { label: '앱이 자동 재시도', state: 'replayed', paymentId: 29 },
    ],
    rows: [recordedRow(29, '2026-10-19T23:38:41.791Z', 'd75953f7')],
    isDone: true,
  },
  buttonLockOnly: {
    attempts: [
      { label: '1번째 누름', state: 'gave_up' },
      { label: '앱이 자동 재시도', state: 'charged', paymentId: 38 },
    ],
    rows: [
      recordedRow(37, '2026-10-19T23:38:46.296Z'),
      recordedRow(38, '2026-10-19T23:38:46.900Z'),
    ],
    isDone: true,
  },
};
const RECORDED = {
  requests: RECORDED_RUNS.withKey.attempts.length,
  chargesWithoutKey: RECORDED_RUNS.withoutKey.rows.length,
  chargesWithKey: RECORDED_RUNS.withKey.rows.length,
  buttonLockOnlyCharges: RECORDED_RUNS.buttonLockOnly.rows.length,
};

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const newOrderId = () => `order-${crypto.randomUUID().slice(0, 18)}`;

/** 실제로 요청을 보내며 진행 상황을 onChange로 알려준다 */
async function runScenario(
  { withKey, clicks }: Scenario,
  onChange: (run: ScenarioRun) => void,
): Promise<ScenarioRun> {
  const orderId = newOrderId();
  // 키는 "결제 한 번"마다 한 번 만들고, 연타·재시도에 같은 키를 쓴다
  const idempotencyKey = withKey ? crypto.randomUUID() : undefined;
  const attempts: Attempt[] = [];
  let rows: PaymentRow[] = [];
  let isDone = false;
  const emit = () => onChange({ attempts: attempts.map((a) => ({ ...a })), rows, isDone });

  const send = async (attempt: Attempt, signal?: AbortSignal) => {
    try {
      const body = await pay({ orderId, amount: AMOUNT, idempotencyKey, signal });
      attempt.state = body.replayed ? 'replayed' : 'charged';
      attempt.paymentId = body.payment.id;
    } catch {
      attempt.state = signal?.aborted ? 'gave_up' : 'failed';
    }
    emit();
  };

  const requests: Promise<void>[] = [];
  const first: Attempt = { label: '1번째 누름', state: 'sending' };
  attempts.push(first);
  emit();
  const firstTimeout = new AbortController();
  requests.push(send(first, firstTimeout.signal));
  const retry = (async () => {
    await sleep(CLIENT_TIMEOUT_MS);
    if (first.state !== 'sending') return;
    firstTimeout.abort(); // 앱은 기다리다 포기 — 하지만 서버는 이미 받은 요청을 계속 처리한다
    const retried: Attempt = { label: '앱이 자동 재시도', state: 'sending' };
    attempts.push(retried);
    emit();
    await send(retried);
  })();
  for (let click = 2; click <= clicks; click++) {
    await sleep(CLICK_GAP_MS);
    const attempt: Attempt = { label: `${click}번째 누름`, state: 'sending' };
    attempts.push(attempt);
    emit();
    requests.push(send(attempt));
  }

  const poll = async () => {
    rows = await listPayments(orderId);
    emit();
  };
  const settled = Promise.all([...requests, retry]);
  let finished = false;
  void settled.finally(() => (finished = true));
  while (!finished) {
    await poll().catch(() => undefined);
    await sleep(POLL_MS);
  }
  await sleep(300); // 포기한 첫 요청도 서버에선 끝까지 처리된다 → 한 번 더 확인
  await poll().catch(() => undefined);
  isDone = true;
  emit();
  return { attempts, rows, isDone };
}

const emptyRun: ScenarioRun = { attempts: [], rows: [], isDone: false };

export default function PaymentDemo() {
  const [runs, setRuns] = useState<{ withoutKey: ScenarioRun; withKey: ScenarioRun } | null>(null);
  const shown = runs ?? RECORDED_RUNS;
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setIsRunning(true);
    setError(null);
    setRuns({ withoutKey: emptyRun, withKey: emptyRun });
    try {
      const [withoutKey, withKey] = await Promise.all([
        runScenario({ withKey: false, clicks: 3 }, (progress) =>
          setRuns((current) => current && { ...current, withoutKey: progress }),
        ),
        runScenario({ withKey: true, clicks: 3 }, (progress) =>
          setRuns((current) => current && { ...current, withKey: progress }),
        ),
      ]);
      if ([...withoutKey.attempts, ...withKey.attempts].some((a) => a.state === 'failed'))
        setError('일부 요청이 실패했어요 (요청 한도일 수 있어요). 잠시 뒤 다시 눌러 주세요.');
    } catch {
      setError('서버에 연결하지 못했어요.');
    } finally {
      setIsRunning(false);
    }
  };

  const liveChargesWithoutKey = runs?.withoutKey.isDone ? runs.withoutKey.rows.length : null;
  const liveChargesWithKey = runs?.withKey.isDone ? runs.withKey.rows.length : null;
  const chargesWithoutKey = liveChargesWithoutKey ?? RECORDED.chargesWithoutKey;
  const chargesWithKey = liveChargesWithKey ?? RECORDED.chargesWithKey;
  const requestCount = runs?.withKey.isDone ? runs.withKey.attempts.length : RECORDED.requests;
  const sourceLabel =
    liveChargesWithKey !== null
      ? '방금 실제 서버에서 실행한 결과'
      : `지난 실측 기록 (${RECORDED_AT}, 로컬 MySQL)`;

  return (
    <>
      <section className={ui.wide}>
        <p className={ui.lead} style={{ marginBottom: 'var(--space-6)' }}>
          아래 큰 버튼 하나로 <b>두 실험이 나란히</b> 돌아요. 두 줄 모두 똑같이 요청 4개(세 번 누름
          + 앱의 자동 재시도)를 보내고, 주문도 줄마다 따로 하나씩이에요. 다른 건 번호표가 있느냐
          없느냐 하나뿐이에요.
        </p>
        <div className={flow.stage}>
          <div className={flow.lanes}>
            <PaymentLane title="실험 A · 번호표 없이" run={shown.withoutKey} />
            <PaymentLane title="실험 B · 번호표(Idempotency-Key)와 함께" run={shown.withKey} />
          </div>
          <div className={flow.stageSide}>
            <p className={ui.source}>{sourceLabel}</p>
            <p className={flow.bigNumber}>
              <span className={ui.failText}>{chargesWithoutKey}번</span> →{' '}
              <span className={ui.goodText}>{chargesWithKey}번</span>
            </p>
            <p className={flow.bigNumberLabel}>
              실제로 결제된 횟수 (같은 결제 요청 {requestCount}개)
            </p>
            <Button
              size="big"
              data-demo="결제 세 번 연타"
              onClick={() => void run()}
              disabled={isRunning}
            >
              {isRunning ? '결제하는 중…' : '결제 버튼 세 번 연달아 눌러 보기'}
            </Button>
            <p className={ui.hint}>
              실제 서버로 결제 요청을 보내요: 실험마다 버튼을 0.09초 간격으로 세 번 누르고, 첫
              응답이 0.6초 안에 안 오면 앱이 한 번 더 보내요. 그래서 한 번 누르면 요청은 모두
              8개(실험마다 4개)예요. 결제사 승인은 0.9초 걸리게 해 뒀어요(가짜 결제, 돈은 안
              나가요).
            </p>
            {error && <p className={ui.errorLine}>{error}</p>}
          </div>
        </div>
        {shown.withKey.isDone && shown.withoutKey.isDone && (
          <Conclusion isGood>
            번호표가 없으면 요청 {shown.withoutKey.attempts.length}개가 결제{' '}
            {shown.withoutKey.rows.length}건(
            {won(shown.withoutKey.rows.length * AMOUNT)}). 같은 번호표를 붙이면 결제{' '}
            {shown.withKey.rows.length}건, 나머지 요청은 같은 영수증(결제 #
            {shown.withKey.rows[0]?.id})을 돌려받았어요. 앱이 포기한 첫 요청도 서버에선 끝까지
            처리됐어요.
          </Conclusion>
        )}
      </section>

      <ButtonLockSection />

      <section className={ui.column}>
        <h2 className={ui.sectionTitle}>동시에 도착해도 딱 한 번</h2>
        <p className={ui.lead}>
          "이 번호표로 결제한 적 있나 먼저 찾아보고, 없으면 결제"는 위험해요. 두 요청이 동시에
          찾아보면 둘 다 "없음"을 보고 둘 다 결제하거든요(1장 티켓팅과 같은 문제). 그래서 번호표
          칸에 "같은 값은 한 줄만" 규칙(unique 제약)을 걸고, 저장을 먼저 시도해요. 데이터베이스가 둘
          중 하나만 받아 주고, 진 쪽은 이긴 쪽의 결제가 끝나길 기다렸다가 같은 영수증을 돌려줘요.
        </p>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>숫자로 본 결과</h2>
        <ResultNumbers
          items={[
            {
              value: `${chargesWithoutKey}번 → ${chargesWithKey}번`,
              tone: 'good',
              label: '결제된 횟수 (번호표 없이 → 함께)',
              detail: `같은 결제 요청 ${requestCount}개: 연달아 세 번 누름 + 앱의 자동 재시도 한 번`,
            },
            {
              value: `${Math.max(0, requestCount - chargesWithKey)}번`,
              label: '같은 영수증을 돌려받은 요청',
              detail: '두 번째부터는 새로 결제하지 않고 첫 결제 결과를 그대로 돌려줘요',
            },
            {
              value: `${RECORDED.buttonLockOnlyCharges}번`,
              tone: 'fail',
              label: '버튼만 잠갔을 때 결제된 횟수',
              detail: '버튼은 한 번만 눌렸지만, 앱의 자동 재시도가 두 번째 결제를 만들었어요',
            },
          ]}
          source={`${sourceLabel === '방금 실제 서버에서 실행한 결과' ? '첫 두 숫자는 방금 결과, ' : ''}버튼 잠금 숫자는 ${RECORDED_AT} 로컬 실측 (NestJS + MySQL 8.4). 결제사는 0.9초 걸리는 가짜예요.`}
        />
      </section>

      <section className={ui.wide}>
        <DevDetails description="Idempotency-Key 헤더, unique 제약 + INSERT 먼저, processing → paid, 재전송 응답, 실제 Payment 행">
          <DevFlow content={DOUBLE_PAY_DEV_FLOW} />
          <div className={`${ui.fixes} ${ui.fixesTwo}`}>
            <PaymentTable
              title={`번호표 없이 — Payment 행${runs ? '' : ' (지난 기록)'}`}
              rows={shown.withoutKey.rows}
            />
            <PaymentTable
              title={`번호표와 함께 — Payment 행${runs ? '' : ' (지난 기록)'}`}
              rows={shown.withKey.rows}
            />
          </div>
        </DevDetails>
      </section>
    </>
  );
}

const ATTEMPT_TEXT: Record<AttemptState, string> = {
  sending: '보내는 중',
  gave_up: '앱이 기다리다 포기',
  charged: '새 결제',
  replayed: '같은 영수증',
  failed: '실패',
};
const ATTEMPT_COLOR: Record<AttemptState, string> = {
  sending: '#345e72',
  gave_up: '#5e564b',
  charged: '#a3321f',
  replayed: '#44633d',
  failed: '#5e564b',
};

/** 요청 하나 = 점 하나. 보내는 동안 버튼↔서버를 오가고, 끝나면 아래 줄에 결과. 오른쪽은 실제 DB 결제 행 */
function PaymentLane({ title, run }: { title: string; run: ScenarioRun | null }) {
  const attempts = run?.attempts ?? [];
  const rows = run?.rows ?? [];
  return (
    <div>
      <p className={flow.laneTitle}>
        {title} <small>· 실제 결제 기록 {rows.length}건</small>
      </p>
      <svg
        className={flow.flowSvg}
        viewBox="0 0 460 196"
        role="img"
        aria-label={`${title}: 결제 ${rows.length}건`}
      >
        <rect
          x="10"
          y="20"
          width="84"
          height="40"
          rx="8"
          fill="#f2c7a2"
          stroke="#2b2620"
          strokeWidth="1.8"
        />
        <text x="52" y="45" textAnchor="middle" fontSize="14" fontWeight="700" fill="#2b2620">
          결제 버튼
        </text>
        <rect
          x="186"
          y="16"
          width="84"
          height="48"
          rx="8"
          fill="#ede5d5"
          stroke="#2b2620"
          strokeWidth="1.8"
        />
        <text x="228" y="45" textAnchor="middle" fontSize="14" fontWeight="700" fill="#2b2620">
          서버
        </text>
        <path
          d="M98 40 H182 M274 40 H296"
          stroke="#b9ac95"
          strokeWidth="1.5"
          strokeDasharray="4 5"
        />
        {attempts.map((attempt, index) =>
          attempt.state === 'sending' ? (
            <circle
              key={index}
              cx="102"
              cy={32 + (index % 3) * 8}
              r="5.5"
              fill={ATTEMPT_COLOR.sending}
              className={flow.pending}
              style={{ '--dx': '76px' } as CSSProperties}
            />
          ) : null,
        )}
        {attempts.map((attempt, index) => (
          <g key={index}>
            <circle cx="18" cy={92 + index * 25} r="5.5" fill={ATTEMPT_COLOR[attempt.state]} />
            <text x="30" y={97 + index * 25} fontSize="13.5" fill="#2b2620">
              {attempt.label} →{' '}
              <tspan fontWeight="800" fill={ATTEMPT_COLOR[attempt.state]}>
                {ATTEMPT_TEXT[attempt.state]}
                {attempt.paymentId ? ` #${attempt.paymentId}` : ''}
              </tspan>
            </text>
          </g>
        ))}
        {attempts.length === 0 && (
          <text x="14" y="104" fontSize="13.5" fill="#5e564b">
            아직 안 보냈어요
          </text>
        )}
        <rect
          x="300"
          y="10"
          width="150"
          height="176"
          rx="6"
          fill="#fbf8f2"
          stroke="#2b2620"
          strokeWidth="1.8"
        />
        <text x="312" y="32" fontSize="13" fill="#5e564b">
          결제 기록 (데이터베이스)
        </text>
        {rows.slice(0, 6).map((row, index) => (
          <g key={row.id} className={flow.rowNew}>
            <rect
              x="308"
              y={42 + index * 23}
              width="134"
              height="19"
              rx="3"
              fill={row.status === 'paid' ? '#f2d3c8' : '#ede5d5'}
            />
            <text x="314" y={56 + index * 23} fontSize="12.5" fill="#2b2620">
              #{row.id} {row.status === 'paid' ? '결제됨' : '처리 중'} {won(row.amount)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function PaymentTable({ title, rows }: { title: string; rows: PaymentRow[] }) {
  return (
    <div className={flow.tableScroll}>
      <p className={ui.source}>{title}</p>
      <table className={flow.dbTable}>
        <thead>
          <tr>
            <th>id</th>
            <th>status</th>
            <th>idempotencyKey</th>
            <th>createdAt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={flow.rowNew}>
              <td>{row.id}</td>
              <td>{row.status}</td>
              <td>
                <code>{row.idempotencyKey ? `${row.idempotencyKey.slice(0, 8)}…` : 'NULL'}</code>
              </td>
              <td>
                {new Date(row.createdAt).toLocaleTimeString('ko-KR', {
                  hour12: false,
                  fractionalSecondDigits: 3,
                })}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4}>위 큰 버튼을 누르면 실제 행이 여기 쌓여요</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 버튼 잠금(disabled)만 했을 때: 사람은 한 번만 누르지만 앱의 재시도가 또 결제한다 */
function ButtonLockSection() {
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const start = async () => {
    setIsRunning(true);
    try {
      await runScenario({ withKey: false, clicks: 1 }, setRun);
    } finally {
      setIsRunning(false);
    }
  };
  return (
    <section className={ui.wide}>
      <div className={ui.column}>
        <h2 className={ui.sectionTitle}>버튼만 잠그면 될까요?</h2>
        <p className={ui.lead}>
          화면에서 할 수 있는 건 버튼을 누르자마자 잠그는(disabled) 거예요. 사람의 연타는 막지만,
          응답이 늦을 때 앱이 알아서 다시 보내는 요청은 못 막아요.
        </p>
      </div>
      <div className={flow.stage}>
        <PaymentLane title="버튼 잠금만, 번호표 없이" run={run ?? RECORDED_RUNS.buttonLockOnly} />
        <div className={flow.stageSide}>
          <p className={flow.bigNumber}>
            <span className={ui.failText}>
              {run?.isDone ? run.rows.length : RECORDED.buttonLockOnlyCharges}번
            </span>
          </p>
          <p className={flow.bigNumberLabel}>버튼은 한 번 눌렀는데 결제된 횟수</p>
          <Button size="small" onClick={() => void start()} disabled={isRunning}>
            {isRunning ? '결제하는 중…' : '잠긴 버튼으로 한 번만 결제'}
          </Button>
          <p className={ui.hint}>
            {run?.isDone
              ? '방금 실제로 보낸 결과예요.'
              : `지난 실측 기록 (${RECORDED_AT}). 눌러서 직접 확인해 보세요.`}
          </p>
        </div>
      </div>
    </section>
  );
}
