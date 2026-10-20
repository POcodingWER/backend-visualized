'use client';

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  editMenu,
  readMenu,
  runStampede,
  runVisitors,
  type Hop,
  type Node,
  type Protection,
  type RedisCommandName,
  type StampedeResult,
  type VisitorsResult,
} from './api';
import { CACHE_DEV_FLOW } from './dev-flow';
import { emptySide, nextSide, versionLabel, watchWhileMounted, type SideState } from './menu-watch';

const RECORDED_AT = '2026-10-20';
/** 지난 실측 (로컬 API + bv-redis + MySQL 8.4). 첫 화면을 빈 상태 없이 보여주려는 값 */
const RECORDED_VISITORS: VisitorsResult = {
  direct: { visitors: 1000, dbReads: 1000, ms: 63 },
  cached: { visitors: 1000, dbReads: 1, ms: 23 },
};
const RECORDED_STAMPEDE: StampedeResult[] = [
  {
    protection: 'none',
    visitors: 1000,
    instances: 3,
    durationMs: 96.4,
    dbReads: 1000,
    commands: { GET: 1000, 'SET EX': 1000, 'SET NX': 0, DEL: 0 },
  },
  {
    protection: 'single-flight',
    visitors: 1000,
    instances: 3,
    durationMs: 9.8,
    dbReads: 3,
    commands: { GET: 1000, 'SET EX': 3, 'SET NX': 0, DEL: 0 },
  },
  {
    protection: 'redis-lock',
    visitors: 1000,
    instances: 3,
    durationMs: 44.8,
    dbReads: 1,
    commands: { GET: 1999, 'SET EX': 1, 'SET NX': 1000, DEL: 1 },
  },
];
const PROTECTION_TITLE: Record<Protection, string> = {
  none: '아무 대책 없이',
  'single-flight': '서버마다 한 명만 (single-flight)',
  'redis-lock': '전체에서 한 명만 (Redis 잠금)',
};
const PROTECTION_TEXT: Record<Protection, string> = {
  none: '메뉴판이 빈 걸 본 손님이 전부 주방으로 달려가요.',
  'single-flight':
    '같은 서버에 온 손님끼리는 한 명만 보내고 나머지는 기다려요. 하지만 서버가 3대면 3명이 가요.',
  'redis-lock':
    'Redis에 열쇠(SET NX)를 하나만 두고, 열쇠를 잡은 한 명만 주방에 가요. 나머지는 잠깐 기다렸다 메뉴판을 다시 봐요.',
};
const POLL_MS = 500;
const WATCH_MS = 7_000;

export default function CacheDemo() {
  return (
    <>
      <VisitorsStage />
      <StaleSection />
      <StampedeSection />
      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>숫자로 본 결과</h2>
        <ResultNumbers
          items={[
            {
              value: `${RECORDED_VISITORS.direct.dbReads}번 → ${RECORDED_VISITORS.cached.dbReads}번`,
              tone: 'good',
              label: '손님 1000명에 데이터베이스를 읽은 횟수',
              detail: '매번 DB로 vs Redis 메뉴판(5초)으로. 메뉴판을 처음 채우는 한 번만 DB에 가요.',
            },
            {
              value: '1000 → 3 → 1',
              label: '메뉴판이 비는 순간 1000명이 몰렸을 때 DB 읽기',
              detail: '대책 없음 → 서버(3대)마다 한 명 → Redis 잠금으로 전체에서 한 명',
            },
            {
              value: '5.2초 → 0초',
              label: '메뉴를 고친 뒤 새 메뉴가 보이기까지',
              detail:
                '메뉴판을 그대로 두면 유효 시간(5초)이 끝날 때까지 옛 메뉴. 고칠 때 메뉴판도 지우면(DEL) 다음 읽기부터 새 메뉴 (0.5초 간격으로 확인).',
            },
          ]}
          source={`${RECORDED_AT} 로컬 실측 — NestJS + Redis 7.4(Docker) + MySQL 8.4, 맥북 한 대. 서버 3대는 API 한 프로세스 안에서 흉내 낸 거예요. 위 버튼들로 직접 다시 잴 수 있어요.`}
        />
      </section>
      <section className={ui.wide}>
        <DevDetails description="cache-aside, TTL(SET EX), cache stampede, single-flight vs 분산 잠금(SET NX PX), 무효화(DEL), Redis 명령 수">
          <DevFlow content={CACHE_DEV_FLOW} />
          <CommandTable results={RECORDED_STAMPEDE} />
        </DevDetails>
      </section>
    </>
  );
}

/* ---------- 큰 무대: 손님 1000명 ---------- */

function VisitorsStage() {
  const [result, setResult] = useState(RECORDED_VISITORS);
  const [isLive, setIsLive] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runCount, setRunCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setIsRunning(true);
    setError(null);
    try {
      setResult(await runVisitors(1000));
      setIsLive(true);
      setRunCount((count) => count + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '서버에 연결하지 못했어요.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className={ui.wide}>
      <div className={flow.stage}>
        <div className={flow.lanes}>
          <VisitorLane
            key={`direct-${runCount}`}
            title="매번 주방(DB)에 물어보기"
            target="db"
            dbReads={result.direct.dbReads}
            visitors={result.direct.visitors}
            elapsedMs={result.direct.ms}
            animate={runCount > 0}
          />
          <VisitorLane
            key={`cached-${runCount}`}
            title="메뉴판(Redis) 먼저 보기"
            target="redis"
            dbReads={result.cached.dbReads}
            visitors={result.cached.visitors}
            elapsedMs={result.cached.ms}
            animate={runCount > 0}
          />
        </div>
        <div className={flow.stageSide}>
          <p className={ui.source}>
            {isLive ? '방금 실제 서버에서 실행한 결과' : `지난 실측 기록 (${RECORDED_AT}, 로컬)`}
          </p>
          <p className={flow.bigNumber}>
            <span className={ui.failText}>{result.direct.dbReads}</span>
            <span style={{ fontSize: '0.5em' }}>번 → </span>
            <span className={ui.goodText}>{result.cached.dbReads}</span>
            <span style={{ fontSize: '0.5em' }}>번</span>
          </p>
          <p className={flow.bigNumberLabel}>손님 1000명에 데이터베이스를 읽은 횟수</p>
          <Button size="big" onClick={() => void run()} disabled={isRunning}>
            {isRunning ? '손님 받는 중…' : '손님 1000명 받기'}
          </Button>
          <p className={ui.hint}>
            실제 서버에서 &quot;오늘 메뉴&quot; 읽기 1000번을 동시에 해요. 왼쪽은 매번 주방(MySQL)에
            묻고, 오른쪽은 5초마다 새로 적는 메뉴판(Redis)을 먼저 봐요. 메뉴판이 이미 채워져 있으면
            주방에는 한 번도 안 가요.
          </p>
          {error && <p className={ui.errorLine}>{error}</p>}
        </div>
      </div>
      <Conclusion isGood>
        같은 1000명인데 주방에 간 횟수가 {result.direct.dbReads}번 → {result.cached.dbReads}번. 걸린
        시간은 {seconds(result.direct.ms)} → {seconds(result.cached.ms)}예요. 대신 메뉴가 바뀌면
        메뉴판에는 최대 5초 늦게 반영돼요. 아래에서 직접 확인해 보세요.
      </Conclusion>
    </section>
  );
}

const DOT_COUNT = 40;
const NODE_X: Record<Node, number> = { api: 150, redis: 300, db: 440 };

/** 점 하나 = 손님 25명. 왼쪽은 전부 DB까지, 오른쪽은 Redis에서 돌아오고 DB에 간 횟수만큼만 DB까지 */
const VisitorLane = memo(function VisitorLane({
  title,
  target,
  dbReads,
  visitors,
  elapsedMs,
  animate,
}: {
  title: string;
  target: 'db' | 'redis';
  dbReads: number;
  visitors: number;
  elapsedMs: number;
  animate: boolean;
}) {
  const perDot = Math.round(visitors / DOT_COUNT);
  return (
    <div>
      <p className={flow.laneTitle}>
        {title}{' '}
        <small>
          · DB {dbReads}번 · {seconds(elapsedMs)}
        </small>
      </p>
      <svg
        className={flow.flowSvg}
        viewBox="0 0 500 130"
        role="img"
        aria-label={`${title}: 데이터베이스 ${dbReads}번`}
      >
        <text x="12" y="70" fontSize="15" fill="#5e564b">
          손님 {visitors}명
        </text>
        <FlowNode x={NODE_X.api} label="서버" fill="#ede5d5" />
        <FlowNode x={NODE_X.redis} label="Redis" fill="#bcd4e0" dim={target === 'db'} />
        <FlowNode x={NODE_X.db} label="DB" fill={dbReads > 1 ? '#f2d3c8' : '#b4c9a9'} />
        <path
          d="M90 65 H104 M196 65 H254 M346 65 H394"
          stroke="#b9ac95"
          strokeWidth="1.5"
          strokeDasharray="4 5"
        />
        <text
          x={NODE_X.db}
          y="118"
          textAnchor="middle"
          fontSize="15"
          fontWeight="800"
          fill={dbReads > 1 ? '#a3321f' : '#44633d'}
        >
          {dbReads}번
        </text>
        {animate &&
          Array.from({ length: DOT_COUNT }, (_, index) => {
            const goesToDb = target === 'db' || index < Math.min(dbReads, DOT_COUNT);
            const end = goesToDb ? NODE_X.db : NODE_X.redis;
            return (
              <circle
                key={index}
                cx="96"
                cy={58 + (index % 3) * 7}
                r="3.2"
                fill={goesToDb ? '#a3321f' : '#345e72'}
                className={flow.packet}
                style={
                  {
                    '--dx': `${end - 96}px`,
                    '--dy': '0px',
                    '--delay': `${index * 45}ms`,
                    '--duration': '900ms',
                  } as CSSProperties
                }
              />
            );
          })}
      </svg>
      <p className={ui.source}>점 하나 = 손님 약 {perDot}명</p>
    </div>
  );
});

function FlowNode({
  x,
  label,
  fill,
  dim = false,
  y = 65,
}: {
  x: number;
  label: string;
  fill: string;
  dim?: boolean;
  y?: number;
}) {
  return (
    <g opacity={dim ? 0.35 : 1}>
      <rect
        x={x - 46}
        y={y - 22}
        width="92"
        height="44"
        rx="8"
        fill={fill}
        stroke="#2b2620"
        strokeWidth="1.8"
      />
      <text x={x} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#2b2620">
        {label}
      </text>
    </g>
  );
}

/* ---------- 내용을 고치면? (TTL 동안 옛 내용) ---------- */

function StaleSection() {
  const [invalidate, setInvalidate] = useState(false);
  const [sides, setSides] = useState<{ db: SideState; cache: SideState }>({
    db: emptySide,
    cache: emptySide,
  });
  const [editedVersion, setEditedVersion] = useState<number | null>(null);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [editHops, setEditHops] = useState<Hop[]>([]);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    // 처음 보이는 내용 (각 쪽 한 번씩 읽기)
    void Promise.all([readMenu('db'), readMenu('cache')])
      .then(([db, cache]) =>
        setSides({
          db: { ...emptySide, read: db, dbReads: 1 },
          cache: { ...emptySide, read: cache, dbReads: cache.source === 'db' ? 1 : 0 },
        }),
      )
      .catch(() => setError('서버(또는 Redis)에 연결하지 못했어요.'));
    return watchWhileMounted(stopRef);
  }, []);

  const editAndWatch = async () => {
    setIsWatching(true);
    setError(null);
    try {
      // 메뉴판이 차 있는 상태에서 바꿔야 "옛 메뉴가 남는" 모습이 보인다 (비어 있으면 한 번 채운다)
      await readMenu('cache');
      const edited = await editMenu(invalidate);
      setEditedVersion(edited.board.version);
      setEditedContent(edited.board.content);
      setEditHops(edited.hops);
      const editedAt = performance.now();
      setSides((current) => ({
        db: { ...current.db, dbReads: 0, freshAfterMs: null },
        cache: { ...current.cache, dbReads: 0, freshAfterMs: null },
      }));
      while (!stopRef.current && performance.now() - editedAt < WATCH_MS) {
        const [db, cache] = await Promise.all([readMenu('db'), readMenu('cache')]);
        const at = performance.now() - editedAt;
        setElapsedMs(at);
        setSides((current) => ({
          db: nextSide(current.db, db, edited.board.version, at),
          cache: nextSide(current.cache, cache, edited.board.version, at),
        }));
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '서버에 연결하지 못했어요.');
    } finally {
      setIsWatching(false);
    }
  };

  const cacheFresh = sides.cache.freshAfterMs;
  return (
    <section className={ui.wide}>
      <div className={ui.column}>
        <h2 className={ui.sectionTitle}>메뉴를 바꾸면 언제 보일까요?</h2>
        <p className={ui.lead}>
          주방에서 메뉴를 바꾼 뒤 7초 동안 0.5초마다 양쪽을 읽어 봐요. 왼쪽은 바로 바뀌지만 매번
          주방에 가고, 오른쪽은 메뉴판을 다시 확인할 때(최대 5초)까지 옛 메뉴가 보여요.
        </p>
      </div>
      <div className={`${ui.fixes} ${ui.fixesTwo}`}>
        <MenuSide title="매번 DB" side={sides.db} editedVersion={editedVersion} />
        <MenuSide title="Redis 메뉴판 (5초)" side={sides.cache} editedVersion={editedVersion} />
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
          alignItems: 'center',
          marginTop: 'var(--space-6)',
        }}
      >
        <Button size="small" onClick={() => void editAndWatch()} disabled={isWatching}>
          {isWatching
            ? `지켜보는 중… ${elapsedMs ? (elapsedMs / 1000).toFixed(1) : '0.0'}초`
            : '주방에서 메뉴 바꾸기'}
        </Button>
        <label className={flow.toggle}>
          <input
            type="checkbox"
            checked={invalidate}
            onChange={(event) => setInvalidate(event.target.checked)}
            disabled={isWatching}
          />
          바꿀 때 메뉴판도 지우기 (무효화)
        </label>
      </div>
      {editedContent && (
        <p className={ui.goodText} style={{ marginTop: 'var(--space-3)', fontWeight: 700 }}>
          주방(DB)에서는 바로 바뀌었어요: {editedContent}
          {!invalidate && editedVersion !== null && sides.cache.freshAfterMs === null
            ? ' · 오른쪽 손님은 메뉴판을 다시 확인할 때까지 옛 메뉴를 봐요'
            : ''}
        </p>
      )}
      {editHops.length > 0 && (
        <HopStrip hops={editHops} runKey={`edit-${editedVersion}`} caption="메뉴 바꾸기" />
      )}
      {editedVersion !== null && !isWatching && (
        <Conclusion isGood={cacheFresh !== null && cacheFresh < 1000}>
          {cacheFresh === null
            ? '7초 안에 오른쪽이 바뀌지 않았어요. 다시 해 보세요.'
            : `왼쪽은 ${(sides.db.freshAfterMs! / 1000).toFixed(1)}초, 오른쪽은 ${(cacheFresh / 1000).toFixed(1)}초 만에 새 메뉴가 보였어요. ${invalidate ? '메뉴판을 지웠더니 바로 바뀌었어요.' : `오류가 아니라 메뉴판(5초)의 대가예요: 그 ${(cacheFresh / 1000).toFixed(1)}초 동안 오른쪽 손님은 옛 메뉴를 봤어요. "메뉴판도 지우기"를 켜고 다시 해 보세요.`} 주방 간 횟수: 왼쪽 ${sides.db.dbReads}번, 오른쪽 ${sides.cache.dbReads}번.`}
        </Conclusion>
      )}
      {error && <p className={ui.errorLine}>{error}</p>}
    </section>
  );
}

function MenuSide({
  title,
  side,
  editedVersion,
}: {
  title: string;
  side: SideState;
  editedVersion: number | null;
}) {
  const { text: versionText, isStale } = versionLabel(side, editedVersion);
  return (
    <article className={ui.fix}>
      <h3>{title}</h3>
      <p
        style={{ fontSize: 'var(--text-lg)', fontWeight: 750 }}
        className={isStale ? ui.failText : undefined}
      >
        {side.read?.board.content ?? '…'}
      </p>
      <dl className={ui.fixStats}>
        <div>
          <dt>지금 보이는 판</dt>
          <dd className={isStale ? ui.failText : ui.goodText}>{versionText}</dd>
        </div>
        <div>
          <dt>주방(DB) 간 횟수</dt>
          <dd>{side.dbReads}번</dd>
        </div>
        {side.read?.ttlLeftMs != null && (
          <div>
            <dt>메뉴판 남은 시간</dt>
            <dd>{(side.read.ttlLeftMs / 1000).toFixed(1)}초</dd>
          </div>
        )}
      </dl>
      {side.read && (
        <HopStrip hops={side.read.hops} runKey={String(side.pollIndex)} caption="방금 읽기" />
      )}
    </article>
  );
}

/** API가 주는 개발 용어(GET, miss, SET EX 5…)를 화면용 쉬운 말로. 원래 용어는 개발자용 자세히에 */
const plainHop = (label: string) => {
  if (label.startsWith('SET EX'))
    return { short: '적어 둠', long: `메뉴판에 ${label.slice(7)}초 동안 적어 둠` };
  const words: Record<string, { short: string; long: string }> = {
    GET: { short: '확인', long: '메뉴판 확인' },
    hit: { short: '있음', long: '있음' },
    miss: { short: '없음', long: '없음' },
    SELECT: { short: '주방에', long: '주방에 물어봄' },
    행: { short: '메뉴', long: '' }, // 문장에선 "주방에 물어봄"에 포함
    UPDATE: { short: '바꿈', long: '주방에서 메뉴 바꿈' },
    DEL: { short: '지움', long: '메뉴판 지움' },
  };
  return words[label] ?? { short: label, long: label };
};

/** 요청 한 번에 오간 것들을 서버 · Redis · DB 사이를 지나가는 조각으로 (runKey가 바뀌면 다시 재생) */
function HopStrip({ hops, runKey, caption }: { hops: Hop[]; runKey: string; caption: string }) {
  const x: Record<Node, number> = { api: 60, redis: 230, db: 400 };
  const sentence = `${caption}: ${hops
    .map((hop) => plainHop(hop.label).long)
    .filter(Boolean)
    .join(' → ')}`;
  return (
    <svg
      className={flow.flowSvg}
      viewBox="0 0 460 96"
      role="img"
      aria-label={sentence}
      style={{ marginTop: 'var(--space-3)' }}
    >
      <FlowNode x={x.api} y={46} label="서버" fill="#ede5d5" />
      <FlowNode x={x.redis} y={46} label="Redis" fill="#bcd4e0" />
      <FlowNode x={x.db} y={46} label="DB" fill="#b4c9a9" />
      <text x="8" y="88" fontSize="12" fill="#5e564b">
        {sentence}
      </text>
      <g key={runKey}>
        {hops.map((hop, index) => {
          const forward = x[hop.to] > x[hop.from];
          const y = forward ? 14 : 78;
          const color =
            hop.label === 'miss' || hop.label === 'DEL'
              ? '#a3321f'
              : hop.to === 'db' || hop.from === 'db'
                ? '#44633d'
                : '#345e72';
          return (
            <g
              key={index}
              className={flow.packet}
              style={
                {
                  '--dx': `${x[hop.to] - x[hop.from]}px`,
                  '--dy': '0px',
                  '--delay': `${index * 260}ms`,
                  '--duration': '520ms',
                } as CSSProperties
              }
            >
              <rect x={x[hop.from] - 30} y={y - 10} width="60" height="18" rx="9" fill={color} />
              <text
                x={x[hop.from]}
                y={y + 4}
                textAnchor="middle"
                fontSize="11.5"
                fontWeight="700"
                fill="#fbf8f2"
              >
                {plainHop(hop.label).short}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/* ---------- 메뉴판이 비는 순간 (cache stampede) ---------- */

function StampedeSection() {
  const [results, setResults] = useState<StampedeResult[]>(RECORDED_STAMPEDE);
  const [isLive, setIsLive] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeline = useMemo(
    () => (isLive ? { durationMs: Math.max(...results.map((result) => result.durationMs)) } : null),
    [isLive, results],
  );
  const replay = useReplay(timeline);
  const [playCount, setPlayCount] = useState(0);
  const { play } = replay;
  useEffect(() => {
    if (playCount > 0) play();
  }, [playCount]); // play는 매 렌더 새 함수라 playCount만 본다

  const run = async () => {
    setIsRunning(true);
    setError(null);
    try {
      setResults(await runStampede(1000, 3));
      setIsLive(true);
      setPlayCount((count) => count + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '서버에 연결하지 못했어요.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className={ui.wide}>
      <div className={ui.column}>
        <h2 className={ui.sectionTitle}>메뉴판이 비는 순간 1000명이 몰리면</h2>
        <p className={ui.lead}>
          메뉴판은 5초마다 비워져요. 하필 그 순간 손님 1000명이 한꺼번에 오면, 다들 "비었네?" 하고
          주방으로 달려가요(캐시 스탬피드). 서버 3대가 손님을 나눠 받는 상황을 실제 Redis와 DB로
          재현해요.
        </p>
      </div>
      <div className={ui.fixes}>
        {results.map((result) => (
          <article key={result.protection} className={ui.fix}>
            <h3>{PROTECTION_TITLE[result.protection]}</h3>
            {result.traces ? (
              <StampedeReplay result={result} elapsedMs={replay.elapsedMs} />
            ) : (
              <StampedeReplay result={result} elapsedMs={Number.POSITIVE_INFINITY} />
            )}
            <dl className={ui.fixStats}>
              <div>
                <dt>주방(DB) 간 횟수</dt>
                <dd className={result.dbReads > 3 ? ui.failText : ui.goodText}>
                  {result.dbReads}번
                </dd>
              </div>
              <div>
                <dt>걸린 시간</dt>
                <dd>{seconds(result.durationMs)}</dd>
              </div>
            </dl>
            <p className={ui.hint}>{PROTECTION_TEXT[result.protection]}</p>
          </article>
        ))}
      </div>
      <p style={{ marginTop: 'var(--space-6)' }}>
        <Button size="small" onClick={() => void run()} disabled={isRunning}>
          {isRunning ? '몰리는 중…' : '메뉴판 비우고 1000명 한꺼번에 보내기'}
        </Button>
      </p>
      <p className={ui.hint}>
        {isLive
          ? '방금 실제로 잰 결과예요. 점 하나 = 손님 10명, 실제 시간을 천천히 다시 보여줘요.'
          : `지난 실측 기록 (${RECORDED_AT}, 로컬). 눌러서 직접 재 보세요.`}
      </p>
      {error && <p className={ui.errorLine}>{error}</p>}
      <Conclusion isGood>
        서버마다 한 명씩 묶는 건 서버 안에서만 통해요. 서버가 늘면 그만큼 주방에 가죠. 모든 서버가
        같이 보는 Redis에 열쇠를 두면, 서버가 몇 대든 주방에 가는 건 한 명이에요.
      </Conclusion>
    </section>
  );
}

const SAMPLE_EVERY = 10;
const STAMPEDE_X = { guests: 16, server: 92, redis: 200, db: 270 };
const SERVER_Y = [38, 88, 138];

/** 손님 → 서버(1~3) → Redis, DB에 간 손님만 DB까지. 끝나기 전 위치는 실측 시작~끝 시각으로 보간 */
const StampedeReplay = memo(function StampedeReplay({
  result,
  elapsedMs,
}: {
  result: StampedeResult;
  elapsedMs: number;
}) {
  const sampled = useMemo(
    () => (result.traces ?? []).filter((_, index) => index % SAMPLE_EVERY === 0),
    [result.traces],
  );
  const finishedDbReads = result.traces
    ? result.traces.filter(
        (trace) =>
          (trace.path === 'db' || trace.path === 'db-fallback') && trace.finishedAtMs <= elapsedMs,
      ).length
    : result.dbReads;
  return (
    <svg
      className={flow.flowSvg}
      viewBox="0 0 300 180"
      role="img"
      aria-label={`${PROTECTION_TITLE[result.protection]}: DB ${result.dbReads}번`}
    >
      {SERVER_Y.map((y, index) => (
        <g key={y}>
          <rect
            x={STAMPEDE_X.server - 22}
            y={y - 14}
            width="44"
            height="28"
            rx="5"
            fill="#ede5d5"
            stroke="#2b2620"
            strokeWidth="1.4"
          />
          <text x={STAMPEDE_X.server} y={y + 4} textAnchor="middle" fontSize="10" fill="#2b2620">
            서버{index + 1}
          </text>
        </g>
      ))}
      <rect
        x={STAMPEDE_X.redis - 26}
        y="20"
        width="52"
        height="40"
        rx="6"
        fill="#bcd4e0"
        stroke="#2b2620"
        strokeWidth="1.4"
      />
      <text
        x={STAMPEDE_X.redis}
        y="44"
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="700"
        fill="#2b2620"
      >
        Redis
      </text>
      <rect
        x={STAMPEDE_X.db - 26}
        y="112"
        width="52"
        height="44"
        rx="6"
        fill={result.dbReads > 3 ? '#f2d3c8' : '#b4c9a9'}
        stroke="#2b2620"
        strokeWidth="1.4"
      />
      <text
        x={STAMPEDE_X.db}
        y="132"
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="700"
        fill="#2b2620"
      >
        DB
      </text>
      <text
        x={STAMPEDE_X.db}
        y="148"
        textAnchor="middle"
        fontSize="11"
        fontWeight="800"
        fill={result.dbReads > 3 ? '#a3321f' : '#44633d'}
      >
        {finishedDbReads}번
      </text>
      <text x="6" y="174" fontSize="9.5" fill="#5e564b">
        파란 점: 주방에 안 간 손님 · 빨간 점: 주방으로 간 손님
      </text>
      {sampled.map((trace, index) => {
        if (elapsedMs >= trace.finishedAtMs) return null;
        const start = { x: STAMPEDE_X.guests, y: 20 + (index % 14) * 10 };
        const serverPoint = { x: STAMPEDE_X.server, y: SERVER_Y[trace.instance % 3]! };
        const goesToDb = trace.path === 'db' || trace.path === 'db-fallback';
        const end = goesToDb
          ? { x: STAMPEDE_X.db, y: 134 }
          : trace.path === 'waited' && result.protection === 'single-flight'
            ? serverPoint
            : { x: STAMPEDE_X.redis, y: 40 };
        const ratio =
          elapsedMs < trace.startedAtMs
            ? 0
            : (elapsedMs - trace.startedAtMs) /
              Math.max(0.1, trace.finishedAtMs - trace.startedAtMs);
        const via =
          ratio < 0.5
            ? { from: start, to: serverPoint, t: ratio * 2 }
            : { from: serverPoint, to: end, t: (ratio - 0.5) * 2 };
        return (
          <circle
            key={index}
            cx={via.from.x + (via.to.x - via.from.x) * via.t}
            cy={via.from.y + (via.to.y - via.from.y) * via.t}
            r="2.6"
            fill={goesToDb ? '#a3321f' : '#345e72'}
          />
        );
      })}
    </svg>
  );
});

function CommandTable({ results }: { results: StampedeResult[] }) {
  const commands: RedisCommandName[] = ['GET', 'SET NX', 'SET EX', 'DEL'];
  return (
    <div className={flow.tableScroll}>
      <p className={ui.source}>
        스탬피드 1000명 (서버 3대) — Redis 명령 수와 DB 읽기, {RECORDED_AT} 실측
      </p>
      <table className={flow.dbTable}>
        <thead>
          <tr>
            <th>대책</th>
            {commands.map((command) => (
              <th key={command}>{command}</th>
            ))}
            <th>DB SELECT</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.protection}>
              <td>
                <code>{result.protection}</code>
              </td>
              {commands.map((command) => (
                <td key={command}>{result.commands[command]}</td>
              ))}
              <td>{result.dbReads}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
