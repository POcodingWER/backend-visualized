'use client';

import { createTracker, type SendInfo, type Tracker } from '@bv/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '../lib/api';
import DailyChart, { type Daily } from './DailyChart';
import s from './pipeline.module.css';

const FLUSH_INTERVAL_MS = 10_000;
const MAX_BATCH = 10;
const CRON_MS = 5 * 60_000;

type StageId = 'browser' | 'sdk' | 'network' | 'api' | 'db' | 'agg' | 'sse';

const STAGES: { id: StageId; icon: string; title: string; sub: string; why: string }[] = [
  {
    id: 'browser',
    icon: '🖱️',
    title: '브라우저',
    sub: '사용자 클릭',
    why: '사용자의 행동이 이벤트가 됩니다. 클릭마다 바로 서버로 보내면 요청이 폭증하므로, 일단 SDK에 맡깁니다.',
  },
  {
    id: 'sdk',
    icon: '📥',
    title: 'SDK 큐',
    sub: `${MAX_BATCH}개 또는 ${FLUSH_INTERVAL_MS / 1000}초`,
    why: '이벤트를 메모리 큐에 모았다가 한 번에 보냅니다. 요청 수를 줄이고, 탭을 닫을 땐 sendBeacon, 실패하면 localStorage에 보관 후 재전송합니다.',
  },
  {
    id: 'network',
    icon: '📦',
    title: '네트워크',
    sub: '요청 1개 = 이벤트 N개',
    why: 'HTTP 요청마다 연결·헤더·파싱 비용이 듭니다. 이벤트를 묶으면 같은 양을 훨씬 적은 요청으로 보냅니다.',
  },
  {
    id: 'api',
    icon: '🛡️',
    title: 'API',
    sub: '검증 · 레이트 리밋',
    why: 'DTO 검증(배치당 1~100개)으로 잘못된 데이터를 막고, IP당 200req/10s 제한으로 폭주를 429로 거절해 DB를 보호합니다.',
  },
  {
    id: 'db',
    icon: '🗄️',
    title: 'MySQL',
    sub: 'createMany',
    why: '배치를 INSERT 한 문장·한 커밋으로 저장합니다. 행마다 커밋하는 것보다 수십 배 빠릅니다.',
  },
  {
    id: 'agg',
    icon: '🧮',
    title: '집계 잡',
    sub: '5분마다 일별 롤업',
    why: '원본 이벤트를 매번 GROUP BY 하면 느려집니다. 주기적으로 일별 집계 테이블에 미리 계산해 두고 차트는 그것만 읽습니다.',
  },
  {
    id: 'sse',
    icon: '📡',
    title: '실시간 SSE',
    sub: '서버 → 브라우저 push',
    why: '저장이 끝나면 서버가 열린 연결(Server-Sent Events)로 즉시 알려줍니다. 폴링 없이 카운터가 올라갑니다.',
  },
];

const idx = (id: StageId) => STAGES.findIndex((x) => x.id === id);
const pos = (id: StageId) => `${((idx(id) + 0.5) / STAGES.length) * 100}%`;

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

let seq = 0;

export default function Pipeline() {
  const tracker = useRef<Tracker | null>(null);
  const startedAt = useRef(0);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [pending, setPending] = useState(0);
  const [now, setNow] = useState(0);
  const [sentReq, setSentReq] = useState(0);
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
  const [flash, setFlash] = useState<Partial<Record<StageId, number>>>({});

  const pulse = useCallback((id: StageId) => setFlash((f) => ({ ...f, [id]: ++seq })), []);

  const fly = useCallback(
    (p: Omit<Packet, 'key'>) =>
      new Promise<void>((resolve) => {
        const key = ++seq;
        setPackets((ps) => [...ps, { ...p, key }]);
        setTimeout(() => {
          setPackets((ps) => ps.filter((x) => x.key !== key));
          pulse(p.to);
          resolve();
        }, p.ms);
      }),
    [pulse],
  );

  const loadStats = useCallback(async () => {
    try {
      const [st, d] = await Promise.all([
        fetch(`${API_URL}/events/stats`, { cache: 'no-store' }),
        fetch(`${API_URL}/events/stats/daily`, { cache: 'no-store' }),
      ]);
      if (st.ok) setDbTotal(((await st.json()) as Stats).total);
      if (d.ok) setDaily((await d.json()) as Daily);
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
        setSentReq((n) => n + 1);
        if (info.ok && info.status < 400) setSentEvents((n) => n + info.size);
        setLog((l) =>
          [{ key: ++seq, at: new Date().toLocaleTimeString('ko-KR'), info }, ...l].slice(0, 6),
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
          setApiStatus({ code: info.status, key: ++seq });
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
    const id = setInterval(() => {
      setNow(Date.now());
      setPending(tracker.current?.pending() ?? 0);
    }, 200);
    const t = setTimeout(() => void loadStats(), 300);
    return () => {
      clearInterval(id);
      clearTimeout(t);
    };
  }, [loadStats]);

  // SSE: 저장 완료 알림 → DB 행 수/실시간 카운터 갱신 + 브라우저로 push 애니메이션
  useEffect(() => {
    const es = new EventSource(`${API_URL}/events/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('ingested', (e) => {
      const { added } = JSON.parse((e as MessageEvent<string>).data) as { added: number };
      setLive((n) => n + added);
      setDbTotal((n) => (n ?? 0) + added);
      pulse('db');
      void fly({
        from: 'db',
        to: 'browser',
        label: `+${added}`,
        kind: 'push',
        ms: 1300,
        lane: 'bottom',
      }).then(() => pulse('sse'));
    });
    return () => es.close();
  }, [fly, pulse]);

  const click = (count: number) => {
    for (let i = 0; i < count; i++)
      tracker.current?.track('button_click', { button: count > 1 ? 'burst' : 'single' });
    setPending(tracker.current?.pending() ?? 0);
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
      const r = await fetch(`${API_URL}/admin/aggregate`, { method: 'POST' });
      const j = (await r.json()) as { rows: number; ms: number; from: string; to: string };
      setAggResult(`${j.from} ~ ${j.to} 롤업 완료 · upsert ${j.rows}행 · ${j.ms}ms`);
      await loadStats();
    } catch (e) {
      setAggResult(`실패: ${String(e)}`);
    } finally {
      setAggBusy(false);
    }
  };

  const elapsed = now - startedAt.current;
  const nextFlushIn = now ? FLUSH_INTERVAL_MS - (elapsed % FLUSH_INTERVAL_MS) : FLUSH_INTERVAL_MS;
  const nextCronIn = now ? CRON_MS - (now % CRON_MS) : CRON_MS;
  const mmss = (ms: number) => {
    const t = Math.ceil(ms / 1000);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  const shown = active ? STAGES[idx(active)] : null;

  return (
    <main className={s.main}>
      <header className={s.header}>
        <p className={s.kicker}>backend-visualized · mini GA</p>
        <h1>클릭 한 번이 차트가 되기까지</h1>
        <p className={s.lead}>
          아래 버튼을 누르면 <b>실제 SDK</b>가 이벤트를 큐에 쌓고, <b>실제 API</b>로 배치 전송하고,
          MySQL에 저장된 뒤 SSE로 다시 돌아옵니다. 화면의 점과 패킷은 모두 진짜 요청에 맞춰
          움직입니다.
        </p>
      </header>

      <section className={s.controls}>
        <button className={s.primary} onClick={() => click(1)}>
          클릭 이벤트 1개
        </button>
        <button onClick={() => click(25)}>클릭 25연타</button>
        <button onClick={() => void tracker.current?.flush()}>지금 flush</button>
        <span className={s.hint}>
          {MAX_BATCH}개가 쌓이면 즉시, 아니면 {FLUSH_INTERVAL_MS / 1000}초마다 자동 전송
        </span>
      </section>

      <section className={s.board}>
        <div className={s.rail}>
          {STAGES.map((st) => (
            <button
              key={`${st.id}-${flash[st.id] ?? 0}`}
              className={`${s.node} ${flash[st.id] ? s.flash : ''} ${active === st.id ? s.nodeActive : ''}`}
              onClick={() => setActive(active === st.id ? null : st.id)}
              onMouseEnter={() => setActive(st.id)}
            >
              <span className={s.icon}>{st.icon}</span>
              <span className={s.nodeTitle}>{st.title}</span>
              <span className={s.nodeSub}>{st.sub}</span>
              <span className={s.metric}>
                {st.id === 'browser' && (
                  <>탭 세션 {tracker.current?.sessionId.slice(0, 6) ?? '…'}</>
                )}
                {st.id === 'sdk' && (
                  <>
                    <span className={s.queue}>
                      {Array.from({ length: MAX_BATCH }, (_, i) => (
                        <i key={i} className={i < pending ? s.qOn : s.qOff} />
                      ))}
                    </span>
                    대기 <b>{pending}</b>/{MAX_BATCH} · 자동 flush {Math.ceil(nextFlushIn / 1000)}s
                  </>
                )}
                {st.id === 'network' && (
                  <>
                    요청 <b>{sentReq}</b>개로 이벤트 <b>{sentEvents}</b>개
                  </>
                )}
                {st.id === 'api' &&
                  (apiStatus ? (
                    <span
                      key={apiStatus.key}
                      className={`${s.badge} ${apiStatus.code === 202 || apiStatus.code === 0 ? s.ok : s.err}`}
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
                {st.id === 'db' && (
                  <>
                    events <b>{dbTotal?.toLocaleString() ?? '…'}</b>행
                  </>
                )}
                {st.id === 'agg' && <>다음 자동 실행 {mmss(nextCronIn)}</>}
                {st.id === 'sse' && (
                  <>
                    {connected ? '🟢' : '🔴'} 이 화면에서 <b>+{live}</b>
                  </>
                )}
              </span>
            </button>
          ))}
          <div className={s.lineTop} />
          <div className={s.lineBottom}>
            <span>SSE push ← 저장 완료 알림</span>
          </div>
          {packets.map((p) => (
            <span
              key={p.key}
              className={`${s.packet} ${s[p.kind]} ${p.lane === 'bottom' ? s.laneBottom : s.laneTop}`}
              style={
                {
                  '--from': pos(p.from),
                  '--to': pos(p.to),
                  animationDuration: `${p.ms}ms`,
                } as React.CSSProperties
              }
            >
              {p.label}
            </span>
          ))}
        </div>
        <div className={s.explain}>
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

      <section className={s.grid}>
        <div className={s.card}>
          <h2>📦 네트워크 요청 로그 (SDK onSend 훅)</h2>
          {log.length === 0 ? (
            <p className={s.muted}>아직 전송된 배치가 없습니다.</p>
          ) : (
            <table className={s.table}>
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
                {log.map((r) => (
                  <tr key={r.key}>
                    <td>{r.at}</td>
                    <td>{REASON[r.info.reason]}</td>
                    <td>
                      요청 1개에 <b>{r.info.size}</b>개
                    </td>
                    <td className={r.info.status === 202 ? s.okText : s.errText}>
                      {r.info.transport === 'beacon' ? 'beacon' : r.info.status || 'network error'}
                      {r.info.stored ? ' (보관→재전송)' : ''}
                    </td>
                    <td>{Math.round(r.info.durationMs)}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <RateLimit />
      </section>

      <Compare />

      <section className={s.card}>
        <div className={s.cardHead}>
          <h2>🧮 집계 단계의 산출물 — 최근 7일 (UTC, EventDailyStat)</h2>
          <button onClick={() => void aggregate()} disabled={aggBusy}>
            {aggBusy ? '집계 중…' : '지금 집계 실행'}
          </button>
        </div>
        <p className={s.muted}>
          크론이 5분마다 어제~오늘 원본 이벤트를 일별로 GROUP BY 해서 집계 테이블에 upsert 합니다.
          방금 보낸 이벤트는 다음 집계(또는 버튼) 이후 차트에 반영됩니다.
          {aggResult && <span className={s.okText}> · {aggResult}</span>}
        </p>
        {daily ? <DailyChart daily={daily} /> : <p className={s.muted}>불러오는 중…</p>}
      </section>
    </main>
  );
}

/** 단건 vs 배치: 같은 N개 이벤트를 실제 API로 보내 요청 수/시간 비교 */
function Compare() {
  const [n, setN] = useState(50);
  const [single, setSingle] = useState<{ done: number; ms?: number } | null>(null);
  const [batch, setBatch] = useState<{ done: number; ms?: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const ev = (i: number, mode: string) => ({
    name: 'compare_demo',
    properties: { mode, i },
    sessionId: 'compare-demo',
    occurredAt: new Date().toISOString(),
  });

  const run = async () => {
    setBusy(true);
    setSingle({ done: 0 });
    setBatch({ done: 0 });
    // 단건: 이벤트마다 POST /events (동시 10)
    let t0 = performance.now();
    let next = 0;
    const worker = async () => {
      while (next < n) {
        const i = next++;
        await fetch(`${API_URL}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ev(i, 'single')),
        }).catch(() => null);
        setSingle((x) => ({ done: (x?.done ?? 0) + 1 }));
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    setSingle({ done: n, ms: performance.now() - t0 });
    // 배치: 100개씩 POST /events/batch
    t0 = performance.now();
    for (let i = 0; i < n; i += 100) {
      const events = Array.from({ length: Math.min(100, n - i) }, (_, k) => ev(i + k, 'batch'));
      await fetch(`${API_URL}/events/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      }).catch(() => null);
      setBatch((x) => ({ done: (x?.done ?? 0) + 1 }));
    }
    setBatch({ done: Math.ceil(n / 100), ms: performance.now() - t0 });
    setBusy(false);
  };

  const Lane = ({
    title,
    total,
    st,
    color,
  }: {
    title: string;
    total: number;
    st: typeof single;
    color: string;
  }) => (
    <div className={s.lane}>
      <div className={s.laneHead}>
        <b>{title}</b>
        <span>
          HTTP 요청 <b>{st?.done ?? 0}</b>/{total}
          {st?.ms !== undefined && ` · ${Math.round(st.ms)}ms`}
        </span>
      </div>
      <div className={s.reqs}>
        {Array.from({ length: total }, (_, i) => (
          <i key={i} style={{ background: i < (st?.done ?? 0) ? color : undefined }} />
        ))}
      </div>
    </div>
  );

  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <h2>⚖️ 단건 요청 vs 배치 요청 — 같은 이벤트 {n}개</h2>
        <div>
          {[20, 50, 100].map((v) => (
            <button
              key={v}
              className={v === n ? s.primary : ''}
              onClick={() => setN(v)}
              disabled={busy}
            >
              {v}개
            </button>
          ))}{' '}
          <button className={s.primary} onClick={() => void run()} disabled={busy}>
            {busy ? '실행 중…' : '실제로 보내보기'}
          </button>
        </div>
      </div>
      <Lane title="이벤트마다 POST /events" total={n} st={single} color="#fb7185" />
      <Lane
        title="POST /events/batch (100개씩)"
        total={Math.ceil(n / 100)}
        st={batch}
        color="#34d399"
      />
      <div className={s.bench}>
        <p>
          <b>벤치마크 (docs/benchmarks/stage2-ingest.md, 10,000 이벤트, 로컬 M1 Pro)</b>
        </p>
        <div className={s.benchRow}>
          <span>HTTP 단건 POST /events × 10,000</span>
          <span className={s.barWrap}>
            <span className={s.bar} style={{ width: '100%', background: '#fb7185' }} />
          </span>
          <span>16~19s</span>
        </div>
        <div className={s.benchRow}>
          <span>HTTP 배치 100개 × 100 요청</span>
          <span className={s.barWrap}>
            <span className={s.bar} style={{ width: '1.6%', background: '#34d399' }} />
          </span>
          <span>0.25~0.29s</span>
        </div>
        <div className={s.benchRow}>
          <span>DB create() 순차 × 10,000</span>
          <span className={s.barWrap}>
            <span className={s.bar} style={{ width: '100%', background: '#fb923c' }} />
          </span>
          <span>~70s</span>
        </div>
        <div className={s.benchRow}>
          <span>DB createMany() 100개 × 100</span>
          <span className={s.barWrap}>
            <span className={s.bar} style={{ width: '1.5%', background: '#22d3ee' }} />
          </span>
          <span>~1s</span>
        </div>
        <p className={s.muted}>
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
  const [res, setRes] = useState<{ ok: number; limited: number; other: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const acc = { ok: 0, limited: 0, other: 0 };
    setRes({ ...acc });
    let next = 0;
    const worker = async () => {
      while (next < 210) {
        next++;
        const r = await fetch(`${API_URL}/events/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            events: [
              {
                name: 'ratelimit_demo',
                properties: {},
                sessionId: 'ratelimit-demo',
                occurredAt: new Date().toISOString(),
              },
            ],
          }),
        }).catch(() => null);
        if (r?.status === 202) acc.ok++;
        else if (r?.status === 429) acc.limited++;
        else acc.other++;
        setRes({ ...acc });
      }
    };
    await Promise.all(Array.from({ length: 15 }, worker));
    setBusy(false);
  };
  return (
    <div className={s.card}>
      <h2>🛡️ 레이트 리밋 체험</h2>
      <p className={s.muted}>
        API는 IP당 10초에 200요청까지만 받습니다. 요청 210개를 몰아서 보내면 초과분은 <b>429</b>로
        거절되고, SDK는 이런 배치를 버리지 않고 localStorage에 보관했다가 재전송합니다. (실행 후
        10초간은 위 데모 전송도 429가 날 수 있어요)
      </p>
      <button onClick={() => void run()} disabled={busy}>
        {busy ? '보내는 중…' : '요청 210개 몰아 보내기'}
      </button>
      {res && (
        <p>
          <span className={s.okText}>202 × {res.ok}</span> ·{' '}
          <span className={s.errText}>429 × {res.limited}</span>
          {res.other > 0 && <> · 기타 {res.other}</>}
        </p>
      )}
    </div>
  );
}
