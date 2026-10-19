'use client';

import { createTracker, type SendInfo, type Tracker } from '@bv/sdk';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '../../lib/api';
import DailyChart, { type Daily } from './DailyChart';
import styles from './pipeline.module.css';

const FLUSH_INTERVAL_MS = 10_000;
const MAX_BATCH = 10;
const CRON_MS = 5 * 60_000;
/** 동시에 화면에 떠 있는 패킷 최대 수 (폭주 시 DOM/애니메이션 폭증 방지) */
const MAX_PACKETS = 24;
/** SSE ingested 메시지를 모아서 반영하는 주기 */
const SSE_COALESCE_MS = 300;

/** 일정 주기로만 리렌더되는 작은 컴포넌트용 tick */
function useTick(ms: number): number {
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    setNowMs(Date.now());
    const intervalId = setInterval(() => setNowMs(Date.now()), ms);
    return () => clearInterval(intervalId);
  }, [ms]);
  return nowMs;
}

const formatMinutesSeconds = (ms: number) => {
  const totalSeconds = Math.ceil(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
};

/** SDK 큐 상태: 자기 자신만 250ms/1s 주기로 리렌더 (부모 트리 전체 리렌더 X) */
const SdkQueue = memo(function SdkQueue({
  tracker,
  startedAt,
}: {
  tracker: React.RefObject<Tracker | null>;
  startedAt: React.RefObject<number>;
}) {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    // 값이 같으면 React가 렌더를 건너뜀
    const pollId = setInterval(() => setPending(tracker.current?.pending() ?? 0), 250);
    return () => clearInterval(pollId);
  }, [tracker]);
  const now = useTick(1000);
  const nextFlushIn = now
    ? FLUSH_INTERVAL_MS - ((now - startedAt.current) % FLUSH_INTERVAL_MS)
    : FLUSH_INTERVAL_MS;
  return (
    <>
      <span className={styles.queue}>
        {Array.from({ length: MAX_BATCH }, (_, i) => (
          <i key={i} className={i < pending ? styles.qOn : styles.qOff} />
        ))}
      </span>
      대기 <b>{pending}</b>/{MAX_BATCH} · 자동 flush {Math.ceil(nextFlushIn / 1000)}s
    </>
  );
});

const CronCountdown = memo(function CronCountdown() {
  const now = useTick(1000);
  return <>다음 자동 실행 {formatMinutesSeconds(now ? CRON_MS - (now % CRON_MS) : CRON_MS)}</>;
});

const MemoChart = memo(DailyChart);

type StageId = 'browser' | 'sdk' | 'network' | 'api' | 'db' | 'agg' | 'sse';

const STAGES: { id: StageId; icon: string; title: string; sub: string; why: string }[] = [
  {
    id: 'browser',
    icon: '',
    title: '브라우저',
    sub: '사용자 클릭',
    why: '사용자의 행동이 이벤트가 됩니다. 클릭마다 바로 서버로 보내면 요청이 폭증하므로, 일단 SDK에 맡깁니다.',
  },
  {
    id: 'sdk',
    icon: '',
    title: 'SDK 큐',
    sub: `${MAX_BATCH}개 또는 ${FLUSH_INTERVAL_MS / 1000}초`,
    why: '이벤트를 메모리 큐에 모았다가 한 번에 보냅니다. 요청 수를 줄이고, 탭을 닫을 땐 sendBeacon, 실패하면 localStorage에 보관 후 재전송합니다.',
  },
  {
    id: 'network',
    icon: '',
    title: '네트워크',
    sub: '요청 1개 = 이벤트 N개',
    why: 'HTTP 요청마다 연결·헤더·파싱 비용이 듭니다. 이벤트를 묶으면 같은 양을 훨씬 적은 요청으로 보냅니다.',
  },
  {
    id: 'api',
    icon: '',
    title: 'API',
    sub: '검증 · 레이트 리밋',
    why: 'DTO 검증(배치당 1~100개)으로 잘못된 데이터를 막고, IP당 200req/10s 제한으로 폭주를 429로 거절해 DB를 보호합니다.',
  },
  {
    id: 'db',
    icon: '',
    title: 'MySQL',
    sub: 'createMany',
    why: '배치를 INSERT 한 문장·한 커밋으로 저장합니다. 행마다 커밋하는 것보다 수십 배 빠릅니다.',
  },
  {
    id: 'agg',
    icon: '',
    title: '집계 잡',
    sub: '5분마다 일별 롤업',
    why: '원본 이벤트를 매번 GROUP BY 하면 느려집니다. 주기적으로 일별 집계 테이블에 미리 계산해 두고 차트는 그것만 읽습니다.',
  },
  {
    id: 'sse',
    icon: '',
    title: '실시간 SSE',
    sub: '서버 → 브라우저 push',
    why: '저장이 끝나면 서버가 열린 연결(Server-Sent Events)로 즉시 알려줍니다. 폴링 없이 카운터가 올라갑니다.',
  },
];

const stageIndex = (stageId: StageId) => STAGES.findIndex((stage) => stage.id === stageId);
const stagePosition = (stageId: StageId) =>
  `${((stageIndex(stageId) + 0.5) / STAGES.length) * 100}%`;

interface Packet {
  key: number;
  from: StageId;
  to: StageId;
  label: string;
  kind: 'dot' | 'batch' | 'bad' | 'push' | 'agg';
  ms: number;
  lane: 'top' | 'bottom';
}

interface LogRow {
  key: number;
  at: string;
  info: SendInfo;
}

interface Stats {
  total: number;
}

const REASON: Record<SendInfo['reason'], string> = {
  size: '임계치 도달',
  interval: '타이머',
  manual: '수동 flush',
  retry: '재전송',
  unload: '페이지 이탈',
};

let nextKeySequence = 0;

export default function Pipeline() {
  const tracker = useRef<Tracker | null>(null);
  const startedAt = useRef(0);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [sentRequests, setSentRequests] = useState(0);
  const [sentEvents, setSentEvents] = useState(0);
  const [apiStatus, setApiStatus] = useState<{ code: number; key: number } | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [dbTotal, setDbTotal] = useState<number | null>(null);
  const [live, setLive] = useState(0);
  const [connected, setConnected] = useState(false);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [aggResult, setAggResult] = useState<string | null>(null);
  const [aggBusy, setAggBusy] = useState(false);
  const [active, setActive] = useState<StageId | null>(null);
  const nodeRefs = useRef<Partial<Record<StageId, HTMLButtonElement | null>>>({});

  // 하이라이트는 state/key 변경 없이 Web Animations API로 (노드 리마운트·리렌더 X)
  const pulse = useCallback((stageId: StageId) => {
    nodeRefs.current[stageId]?.animate(
      [{ boxShadow: '0 0 0 0 rgba(43,38,32,0.45)' }, { boxShadow: '0 0 0 10px rgba(43,38,32,0)' }],
      { duration: 600, easing: 'ease-out' },
    );
  }, []);
  const doneRefs = useRef(new Map<number, () => void>());

  const fly = useCallback(
    (packet: Omit<Packet, 'key'>) =>
      new Promise<void>((resolve) => {
        const key = ++nextKeySequence;
        doneRefs.current.set(key, () => {
          pulse(packet.to);
          resolve();
        });
        // 상한 초과 시 가장 오래된 패킷을 즉시 완료 처리하고 제거
        setPackets((currentPackets) => {
          const next = [...currentPackets, { ...packet, key }];
          const drop = next.length - MAX_PACKETS;
          if (drop > 0) next.slice(0, drop).forEach((droppedPacket) => finish(droppedPacket.key));
          return drop > 0 ? next.slice(drop) : next;
        });
      }),
    [pulse],
  );

  function finish(key: number) {
    const done = doneRefs.current.get(key);
    doneRefs.current.delete(key);
    if (done) queueMicrotask(done);
  }
  const onPacketEnd = useCallback((key: number) => {
    setPackets((currentPackets) => currentPackets.filter((packet) => packet.key !== key));
    const done = doneRefs.current.get(key);
    doneRefs.current.delete(key);
    done?.();
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const [stage, doneCount] = await Promise.all([
        fetch(`${API_URL}/events/stats`, { cache: 'no-store' }),
        fetch(`${API_URL}/events/stats/daily`, { cache: 'no-store' }),
      ]);
      if (stage.ok) setDbTotal(((await stage.json()) as Stats).total);
      if (doneCount.ok) setDaily((await doneCount.json()) as Daily);
    } catch {
      // API 다운 시 무시
    }
  }, []);

  // SDK: onSend 훅으로 실제 배치 전송 결과를 받아 애니메이션
  useEffect(() => {
    if (tracker.current) return;
    startedAt.current = Date.now();
    tracker.current = createTracker({
      endpoint: API_URL,
      maxBatchSize: MAX_BATCH,
      flushIntervalMs: FLUSH_INTERVAL_MS,
      onSend: (info) => {
        setSentRequests((count) => count + 1);
        if (info.ok && info.status < 400) setSentEvents((count) => count + info.size);
        setLog((previousLog) =>
          [
            { key: ++nextKeySequence, at: new Date().toLocaleTimeString('ko-KR'), info },
            ...previousLog,
          ].slice(0, 6),
        );
        const bad = !info.ok || info.status >= 400;
        void fly({
          from: 'sdk',
          to: 'api',
          label: `${info.size}`,
          kind: bad ? 'bad' : 'batch',
          ms: 1100,
          lane: 'top',
        }).then(() => {
          setApiStatus({ code: info.status, key: ++nextKeySequence });
          if (!bad)
            void fly({
              from: 'api',
              to: 'db',
              label: `${info.size}`,
              kind: 'batch',
              ms: 600,
              lane: 'top',
            });
        });
      },
    });
    tracker.current.track('page_view', { path: window.location.pathname });
    void fly({ from: 'browser', to: 'sdk', label: '', kind: 'dot', ms: 450, lane: 'top' });
  }, [fly]);

  useEffect(() => {
    const loadTimer = setTimeout(() => void loadStats(), 300);
    return () => clearTimeout(loadTimer);
  }, [loadStats]);

  // SSE: 저장 완료 알림 → DB 행 수/실시간 카운터 갱신 + 브라우저로 push 애니메이션
  useEffect(() => {
    const eventSource = new EventSource(`${API_URL}/events/stream`);
    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);
    // 폭주 시 메시지마다 setState+애니메이션 하지 않고 SSE_COALESCE_MS 동안 합쳐서 한 번만 반영
    let pendingAdded = 0;
    let pendingMessages = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const drain = () => {
      timer = null;
      const added = pendingAdded;
      const messageCount = pendingMessages;
      pendingAdded = 0;
      pendingMessages = 0;
      setLive((current) => current + added);
      setDbTotal((current) => (current ?? 0) + added);
      pulse('db');
      void fly({
        from: 'db',
        to: 'browser',
        label: messageCount > 1 ? `+${added} (${messageCount}건)` : `+${added}`,
        kind: 'push',
        ms: 1300,
        lane: 'bottom',
      }).then(() => pulse('sse'));
    };
    eventSource.addEventListener('ingested', (message) => {
      const { added } = JSON.parse((message as MessageEvent<string>).data) as { added: number };
      pendingAdded += added;
      pendingMessages++;
      timer ??= setTimeout(drain, SSE_COALESCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      eventSource.close();
    };
  }, [fly, pulse]);

  const click = (count: number) => {
    for (let i = 0; i < count; i++)
      tracker.current?.track('button_click', { button: count > 1 ? 'burst' : 'single' });
    for (let i = 0; i < Math.min(count, 6); i++) {
      setTimeout(
        () =>
          void fly({ from: 'browser', to: 'sdk', label: '', kind: 'dot', ms: 450, lane: 'top' }),
        i * 60,
      );
    }
  };

  const aggregate = async () => {
    setAggBusy(true);
    void fly({ from: 'db', to: 'agg', label: 'Σ', kind: 'agg', ms: 600, lane: 'top' });
    try {
      // 공개 데모용 엔드포인트: 비밀값 없이 호출, 대신 서버 전체 쿨다운이 있다 (관리자용 /admin/aggregate는 API 키 필요)
      const outcome = await runDemoAggregate();
      if ('retryAfterSeconds' in outcome) {
        setAggResult(
          `쿨다운 중 — 방금 누군가 집계를 실행했어요. ${outcome.retryAfterSeconds ?? '몇'}초 후 다시 시도하세요`,
        );
        return;
      }
      if ('error' in outcome) {
        setAggResult(`실패: ${outcome.error}`);
        return;
      }
      const aggregateResult = outcome.result;
      setAggResult(
        `${aggregateResult.from} ~ ${aggregateResult.to} 롤업 완료 · upsert ${aggregateResult.rows}행 · ${aggregateResult.ms}ms (다음 실행까지 ${aggregateResult.cooldownSeconds}초 쿨다운)`,
      );
      await loadStats();
    } finally {
      setAggBusy(false);
    }
  };

  const shown = active ? STAGES[stageIndex(active)] : null;

  return (
    <div className={styles.main}>
      <section className={styles.controls}>
        <button className={styles.primary} onClick={() => click(1)}>
          클릭 이벤트 1개
        </button>
        <button onClick={() => click(25)}>클릭 25연타</button>
        <button onClick={() => void tracker.current?.flush()}>지금 flush</button>
        <span className={styles.hint}>
          {MAX_BATCH}개가 쌓이면 즉시, 아니면 {FLUSH_INTERVAL_MS / 1000}초마다 자동 전송
        </span>
      </section>

      <section className={styles.board}>
        <div className={styles.rail}>
          {STAGES.map((stage) => (
            <button
              key={stage.id}
              ref={(element) => {
                nodeRefs.current[stage.id] = element;
              }}
              className={`${styles.node} ${active === stage.id ? styles.nodeActive : ''}`}
              onClick={() => setActive(active === stage.id ? null : stage.id)}
              onMouseEnter={() => setActive(stage.id)}
            >
              <span className={styles.icon}>{stage.icon}</span>
              <span className={styles.nodeTitle}>{stage.title}</span>
              <span className={styles.nodeSub}>{stage.sub}</span>
              <span className={styles.metric}>
                {stage.id === 'browser' && (
                  <>탭 세션 {tracker.current?.sessionId.slice(0, 6) ?? '…'}</>
                )}
                {stage.id === 'sdk' && <SdkQueue tracker={tracker} startedAt={startedAt} />}
                {stage.id === 'network' && (
                  <>
                    요청 <b>{sentRequests}</b>개로 이벤트 <b>{sentEvents}</b>개
                  </>
                )}
                {stage.id === 'api' &&
                  (apiStatus ? (
                    <span
                      key={apiStatus.key}
                      className={`${styles.badge} ${apiStatus.code === 202 || apiStatus.code === 0 ? styles.ok : styles.err}`}
                    >
                      {apiStatus.code === 0 ? 'beacon/오류' : apiStatus.code}
                      {apiStatus.code === 202
                        ? ' Accepted'
                        : apiStatus.code === 429
                          ? ' Too Many'
                          : ''}
                    </span>
                  ) : (
                    '대기 중'
                  ))}
                {stage.id === 'db' && (
                  <>
                    events <b>{dbTotal?.toLocaleString() ?? '…'}</b>행
                  </>
                )}
                {stage.id === 'agg' && <CronCountdown />}
                {stage.id === 'sse' && (
                  <>
                    {connected ? '' : ''} 이 화면에서 <b>+{live}</b>
                  </>
                )}
              </span>
            </button>
          ))}
          <div className={styles.lineTop} />
          <div className={styles.lineBottom}>
            <span>SSE push ← 저장 완료 알림</span>
          </div>
          {packets.map((packet) => (
            <span
              key={packet.key}
              className={`${styles.track} ${packet.lane === 'bottom' ? styles.laneBottom : styles.laneTop}`}
              style={
                {
                  '--from': `${stagePosition(packet.from)}`,
                  '--to': `${stagePosition(packet.to)}`,
                  animationDuration: `${packet.ms}ms`,
                } as React.CSSProperties
              }
              onAnimationEnd={(animationEvent) =>
                animationEvent.target === animationEvent.currentTarget && onPacketEnd(packet.key)
              }
            >
              <span className={`${styles.packet} ${styles[packet.kind]}`}>{packet.label}</span>
            </span>
          ))}
        </div>
        <div className={styles.explain}>
          {shown ? (
            <>
              <b>
                {shown.icon} {shown.title}
              </b>{' '}
              — {shown.why}
            </>
          ) : (
            '각 단계에 마우스를 올리면 왜 필요한지 설명이 나옵니다.'
          )}
        </div>
      </section>

      <section className={styles.grid}>
        <div className={styles.card}>
          <h2>네트워크 요청 로그 (SDK onSend 훅)</h2>
          {log.length === 0 ? (
            <p className={styles.muted}>아직 전송된 배치가 없습니다.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>이유</th>
                  <th>이벤트</th>
                  <th>상태</th>
                  <th>소요</th>
                </tr>
              </thead>
              <tbody>
                {log.map((row) => (
                  <tr key={row.key}>
                    <td>{row.at}</td>
                    <td>{REASON[row.info.reason]}</td>
                    <td>
                      요청 1개에 <b>{row.info.size}</b>개
                    </td>
                    <td className={row.info.status === 202 ? styles.okText : styles.errText}>
                      {row.info.transport === 'beacon'
                        ? 'beacon'
                        : row.info.status || 'network error'}
                      {row.info.stored ? ' (보관→재전송)' : ''}
                    </td>
                    <td>{Math.round(row.info.durationMs)}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <RateLimit />
      </section>

      <Compare />

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2>집계 단계의 산출물 — 최근 7일 (UTC, EventDailyStat)</h2>
          <button onClick={() => void aggregate()} disabled={aggBusy}>
            {aggBusy ? '집계 중…' : '지금 집계 실행'}
          </button>
        </div>
        <p className={styles.muted}>
          크론이 5분마다 어제~오늘 원본 이벤트를 일별로 GROUP BY 해서 집계 테이블에 upsert 합니다.
          방금 보낸 이벤트는 다음 집계(또는 버튼) 이후 차트에 반영됩니다.
          {aggResult && <span className={styles.okText}> · {aggResult}</span>}
        </p>
        {daily ? <MemoChart daily={daily} /> : <p className={styles.muted}>불러오는 중…</p>}
      </section>
    </div>
  );
}

type Progress = { done: number; ms?: number } | null;

/** 컴포넌트 밖에 정의 (렌더마다 새 컴포넌트 타입 → 리마운트 방지) */
const Lane = memo(function Lane({
  title,
  total,
  st: stage,
  color,
}: {
  title: string;
  total: number;
  st: Progress;
  color: string;
}) {
  return (
    <div className={styles.lane}>
      <div className={styles.laneHead}>
        <b>{title}</b>
        <span>
          HTTP 요청 <b>{stage?.done ?? 0}</b>/{total}
          {stage?.ms !== undefined && ` · ${Math.round(stage.ms)}ms`}
        </span>
      </div>
      <div className={styles.reqs}>
        {Array.from({ length: total }, (_, i) => (
          <i key={i} style={{ background: i < (stage?.done ?? 0) ? color : undefined }} />
        ))}
      </div>
    </div>
  );
});

/** 요청 폭주 중 setState를 프레임당 최대 1번으로 합치는 헬퍼 */
function rafBatch<T>(apply: (value: T) => void) {
  let latest: T;
  let scheduled = false;
  return (value: T) => {
    latest = value;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply(latest);
    });
  };
}

export type SendResult = { requests: number; ms: number; rejected: number };

/**
 * 같은 이벤트 eventCount개를 실제 API로 두 번 보낸다: 이벤트마다 POST /events(동시 10) → 100개씩 POST /events/batch.
 * rejected = 레이트 리밋(429)이나 네트워크 오류로 저장되지 않은 요청 수.
 */
export async function sendEventsBothWays(
  eventCount: number,
  {
    onSingleProgress,
    onBatchProgress,
  }: { onSingleProgress?: (done: number) => void; onBatchProgress?: (done: number) => void } = {},
): Promise<{ single: SendResult; batch: SendResult }> {
  const makeEvent = (eventIndex: number, mode: string) => ({
    name: 'compare_demo',
    properties: { mode, i: eventIndex },
    sessionId: 'compare-demo',
    occurredAt: new Date().toISOString(),
  });
  const isStored = (response: Response | null) => !!response && response.status < 300;

  let startedAt = performance.now();
  let next = 0;
  let done = 0;
  let singleRejected = 0;
  const worker = async () => {
    while (next < eventCount) {
      const eventIndex = next++;
      const response = await fetch(`${API_URL}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeEvent(eventIndex, 'single')),
      }).catch(() => null);
      if (!isStored(response)) singleRejected++;
      onSingleProgress?.(++done);
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  const single = {
    requests: eventCount,
    ms: performance.now() - startedAt,
    rejected: singleRejected,
  };

  startedAt = performance.now();
  let batchRequests = 0;
  let batchRejected = 0;
  for (let i = 0; i < eventCount; i += 100) {
    const events = Array.from({ length: Math.min(100, eventCount - i) }, (_, k) =>
      makeEvent(i + k, 'batch'),
    );
    const response = await fetch(`${API_URL}/events/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    }).catch(() => null);
    if (!isStored(response)) batchRejected++;
    onBatchProgress?.(++batchRequests);
  }
  return {
    single,
    batch: { requests: batchRequests, ms: performance.now() - startedAt, rejected: batchRejected },
  };
}

export type ProbeCounts = { ok: number; limited: number; other: number };

/** 레이트 리밋 체험: DB에 쓰지 않는 /demo/rate-limit-probe로 요청 total개를 동시 15개씩 몰아 보낸다 */
export async function probeRateLimit(total: number, onProgress?: (counts: ProbeCounts) => void) {
  const counts: ProbeCounts = { ok: 0, limited: 0, other: 0 };
  let next = 0;
  const worker = async () => {
    while (next < total) {
      next++;
      const response = await fetch(`${API_URL}/demo/rate-limit-probe`, { method: 'POST' }).catch(
        () => null,
      );
      if (response?.status === 202) counts.ok++;
      else if (response?.status === 429) counts.limited++;
      else counts.other++;
      onProgress?.(counts);
    }
  };
  await Promise.all(Array.from({ length: 15 }, worker));
  return { ...counts };
}

export type AggregateResult = {
  rows: number;
  ms: number;
  from: string;
  to: string;
  cooldownSeconds: number;
};

/** 공개 데모용 집계 실행 (전역 쿨다운이 있어 429면 retryAfterSeconds를 돌려준다) */
export async function runDemoAggregate(): Promise<
  { result: AggregateResult } | { retryAfterSeconds: number | undefined } | { error: string }
> {
  try {
    const response = await fetch(`${API_URL}/demo/aggregate`, { method: 'POST' });
    if (response.status === 429) {
      const limited = (await response.json().catch(() => ({}))) as { retryAfterSeconds?: number };
      return { retryAfterSeconds: limited.retryAfterSeconds };
    }
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return { result: (await response.json()) as AggregateResult };
  } catch (error) {
    return { error: String(error) };
  }
}

/** 단건 vs 배치: 같은 N개 이벤트를 실제 API로 보내 요청 수/시간 비교 */
function Compare() {
  const [eventCount, setEventCount] = useState(50);
  const [single, setSingle] = useState<{ done: number; ms?: number } | null>(null);
  const [batch, setBatch] = useState<{ done: number; ms?: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setSingle({ done: 0 });
    setBatch({ done: 0 });
    const result = await sendEventsBothWays(eventCount, {
      onSingleProgress: rafBatch<number>((doneCount) =>
        setSingle((previous) => (previous?.ms !== undefined ? previous : { done: doneCount })),
      ),
      onBatchProgress: (doneCount) => setBatch({ done: doneCount }),
    });
    setSingle({ done: result.single.requests, ms: result.single.ms });
    setBatch({ done: result.batch.requests, ms: result.batch.ms });
    setBusy(false);
  };

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>단건 요청 vs 배치 요청 — 같은 이벤트 {eventCount}개</h2>
        <div>
          {[20, 50, 100].map((option) => (
            <button
              key={option}
              className={option === eventCount ? styles.primary : ''}
              onClick={() => setEventCount(option)}
              disabled={busy}
            >
              {option}개
            </button>
          ))}{' '}
          <button className={styles.primary} onClick={() => void run()} disabled={busy}>
            {busy ? '실행 중…' : '실제로 보내보기'}
          </button>
        </div>
      </div>
      <Lane title="이벤트마다 POST /events" total={eventCount} st={single} color="#A3321F" />
      <Lane
        title="POST /events/batch (100개씩)"
        total={Math.ceil(eventCount / 100)}
        st={batch}
        color="#44633D"
      />
      <div className={styles.bench}>
        <p>
          <b>벤치마크 (docs/benchmarks/stage2-ingest.md, 10,000 이벤트, 로컬 M1 Pro)</b>
        </p>
        <div className={styles.benchRow}>
          <span>HTTP 단건 POST /events × 10,000</span>
          <span className={styles.barWrap}>
            <span className={styles.bar} style={{ width: '100%', background: '#A3321F' }} />
          </span>
          <span>16~19s</span>
        </div>
        <div className={styles.benchRow}>
          <span>HTTP 배치 100개 × 100 요청</span>
          <span className={styles.barWrap}>
            <span className={styles.bar} style={{ width: '1.6%', background: '#44633D' }} />
          </span>
          <span>0.25~0.29s</span>
        </div>
        <div className={styles.benchRow}>
          <span>DB create() 순차 × 10,000</span>
          <span className={styles.barWrap}>
            <span className={styles.bar} style={{ width: '100%', background: '#8E4F1F' }} />
          </span>
          <span>~70s</span>
        </div>
        <div className={styles.benchRow}>
          <span>DB createMany() 100개 × 100</span>
          <span className={styles.barWrap}>
            <span className={styles.bar} style={{ width: '1.5%', background: '#345E72' }} />
          </span>
          <span>~1s</span>
        </div>
        <p className={styles.muted}>
          HTTP 기준 약 <b>65배</b>(18.7s → 0.29s). 요청 수가 1/100로 줄고, DB도 행마다 커밋하는 대신
          한 문장·한 커밋으로 저장하기 때문입니다. 위 실측은 이 브라우저↔로컬 API 기준이라 수치가
          다를 수 있습니다.
        </p>
      </div>
    </section>
  );
}

/** 레이트 리밋 체험: 짧은 시간에 요청 210개 → 일부가 429 */
function RateLimit() {
  const [statusCounts, setStatusCounts] = useState<{
    ok: number;
    limited: number;
    other: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setStatusCounts({ ok: 0, limited: 0, other: 0 });
    // 210번 응답마다 setState하지 않고 프레임당 1번만 반영
    const show = rafBatch<ProbeCounts>((latestCounts) => setStatusCounts({ ...latestCounts }));
    setStatusCounts(await probeRateLimit(210, show));
    setBusy(false);
  };
  return (
    <div className={styles.card}>
      <h2>레이트 리밋 체험</h2>
      <p className={styles.muted}>
        API는 IP당 10초에 200요청까지만 받습니다. 요청 210개를 몰아서 보내면 초과분은 <b>429</b>로
        거절됩니다. 수집 API(/events/batch)도 같은 방식으로 막히고, SDK는 이런 배치를 버리지 않고
        localStorage에 보관했다가 재전송합니다. 이 버튼은 공개 서버에 쓰레기 데이터가 쌓이지 않도록
        DB에 쓰지 않는 체험용 엔드포인트로 보냅니다.
      </p>
      <button onClick={() => void run()} disabled={busy}>
        {busy ? '보내는 중…' : '요청 210개 몰아 보내기'}
      </button>
      {statusCounts && (
        <p>
          <span className={styles.okText}>202 × {statusCounts.ok}</span> ·{' '}
          <span className={styles.errText}>429 × {statusCounts.limited}</span>
          {statusCounts.other > 0 && <> · 기타 {statusCounts.other}</>}
        </p>
      )}
    </div>
  );
}
