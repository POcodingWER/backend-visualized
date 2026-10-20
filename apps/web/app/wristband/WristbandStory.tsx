'use client';

import { useState } from 'react';
import { authApi, errorReason, isSession, type Session } from './api';
import { GITHUB_URL } from '../../lib/site';
import { ResultNumbers } from '../components/molecules/ResultNumbers';
import ui from '../components/ui.module.css';
import styles from './auth.module.css';
import { applyRaceOutcome, runRefreshRace, type RefreshMode } from './ConcurrencyRace';
import { readTokensLikeXss, type AttackOutcome, type StorageKind } from './StorageComparison';
import type { AddLogEntry } from './types';
import { Button } from '../components/atoms/Button';
import { Conclusion } from '../components/atoms/Conclusion';
import { INK } from '../components/atoms/ink';

const RECORDED_AT = '2026-10-19';
const FAIL = '#a3321f';

type StoryProps = {
  session: Session | null;
  ensureSession: () => Promise<Session | null>;
  applySession: (session: Session | null, reason?: string) => void;
  addLog: AddLogEntry;
  labelFor: (accessToken: string) => string;
  accessTokenTtlSeconds: number;
  restoreState: 'restoring' | 'restored' | 'none';
};

/** 복사된 영수증 이야기의 네 장면. 서버 응답 코드만 실제 결과에서 채운다. */
type TheftStep = { title: string; outcome: string; ok: boolean };

/** 처음 화면에 보여주는 지난 실측 기록 (같은 흐름을 로컬 API에 실제로 보내 받은 응답) */
const RECORDED_THEFT: TheftStep[] = [
  {
    title: '도둑이 재발급 영수증을 몰래 복사해요',
    outcome: '복사 성공 (손님은 몰라요)',
    ok: false,
  },
  {
    title: '손님이 영수증으로 새 손목밴드를 받아요',
    outcome: '통과 · 새 밴드와 새 영수증을 받음',
    ok: true,
  },
  {
    title: '도둑이 복사본으로 재발급을 시도해요',
    outcome: '거절 · 이미 쓴 영수증이라, 이 로그인으로 받은 영수증이 전부 무효',
    ok: false,
  },
  {
    title: '손님도 다음 재발급에서 막혀요',
    outcome: '거절 · 영수증이 무효가 돼서 다시 로그인해야 함',
    ok: false,
  },
];

export default function WristbandStory(props: StoryProps) {
  return (
    <>
      <CopiedReceiptStage {...props} />
      <RefreshCrowd {...props} />
      <ReloadRecovery {...props} />
      <StorageLockers />
      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>숫자로 본 결과</h2>
        <ResultNumbers
          items={[
            {
              value: '5번 → 1번',
              tone: 'good',
              label: '재발급 창구에 간 횟수',
              detail:
                '밴드가 바랜 순간 요청 5개가 동시에 나갈 때. 각자 가면 4개가 "이미 쓴 영수증"으로 걸려 로그인이 통째로 취소됐어요.',
            },
            {
              value: '첫 사용',
              label: '복사본이 들킨 때',
              detail:
                '복사본이 처음 쓰인 그 요청에서 바로 걸렸고, 그 로그인의 영수증 2장이 모두 무효가 됐어요.',
            },
            {
              value: '3곳 중 1곳',
              tone: 'fail',
              label: '나쁜 스크립트가 토큰을 꺼내 간 곳',
              detail:
                '가방(localStorage)만 열렸어요. 주머니(메모리)와 금고(httpOnly 쿠키)는 못 열었어요.',
            },
          ]}
          source={
            <>
              {RECORDED_AT} 로컬 API(NestJS + MySQL)에 같은 흐름을 직접 보내서 받은 결과예요. 위
              버튼으로 언제든 다시 확인할 수 있어요. 코드:{' '}
              <a href={`${GITHUB_URL}/blob/main/apps/api/src/auth/lib/refresh-token.store.ts`}>
                refresh-token.store.ts
              </a>
              {' · '}
              <a href={`${GITHUB_URL}/blob/main/apps/web/lib/single-flight.ts`}>single-flight.ts</a>
            </>
          }
        />
      </section>
    </>
  );
}

/** 큰 버튼: 탈취 → 손님 재발급 → 도둑 재발급 → 손님 재발급. 실제 /auth API 호출 */
function CopiedReceiptStage({
  ensureSession,
  applySession,
  addLog,
  accessTokenTtlSeconds,
}: StoryProps) {
  const [steps, setSteps] = useState<TheftStep[]>(RECORDED_THEFT);
  const [isLive, setIsLive] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bothKickedOut = !steps[3]!.ok && !steps[2]!.ok;

  const run = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const session = await ensureSession();
      if (!session)
        throw new Error('데모 계정으로 로그인하지 못했어요. 서버가 켜져 있는지 확인해 주세요.');
      const stolen = await authApi.stealRefreshToken();
      addLog({
        actor: 'attacker',
        label: '(탈취) 리프레시 토큰 복사',
        credential: 'RT 쿠키',
        status: stolen.status,
        durationMs: stolen.durationMs,
      });
      if (!('stolenRefreshTokenValue' in stolen.body))
        throw new Error('영수증을 복사하지 못했어요. 다시 눌러 주세요.');
      const stolenToken = stolen.body.stolenRefreshTokenValue;

      const userRefresh = await authApi.refresh(accessTokenTtlSeconds);
      addLog({
        actor: 'user',
        label: 'POST /auth/refresh',
        credential: 'RT 쿠키',
        status: userRefresh.status,
        reason: errorReason(userRefresh.body),
        durationMs: userRefresh.durationMs,
      });
      if (isSession(userRefresh.body)) applySession(userRefresh.body);

      const attacker = await authApi.refreshWithStolenToken(stolenToken);
      addLog({
        actor: 'attacker',
        label: 'POST /auth/refresh (훔친 토큰)',
        credential: '복사본',
        status: attacker.status,
        reason: errorReason(attacker.body),
        durationMs: attacker.durationMs,
      });

      const userAgain = await authApi.refresh(accessTokenTtlSeconds);
      addLog({
        actor: 'user',
        label: 'POST /auth/refresh',
        credential: 'RT 쿠키',
        status: userAgain.status,
        reason: errorReason(userAgain.body),
        durationMs: userAgain.durationMs,
      });
      if (isSession(userAgain.body)) applySession(userAgain.body);
      else applySession(null, errorReason(userAgain.body));

      const attackerCaught = errorReason(attacker.body) === 'refresh_token_reuse_detected';
      setSteps([
        { ...RECORDED_THEFT[0]!, outcome: RECORDED_THEFT[0]!.outcome },
        {
          ...RECORDED_THEFT[1]!,
          ok: userRefresh.ok,
          outcome: userRefresh.ok
            ? RECORDED_THEFT[1]!.outcome
            : `실패 (서버 응답 ${userRefresh.status})`,
        },
        {
          ...RECORDED_THEFT[2]!,
          ok: attacker.ok,
          outcome: attackerCaught
            ? RECORDED_THEFT[2]!.outcome
            : `예상과 다름 (서버 응답 ${attacker.status})`,
        },
        {
          ...RECORDED_THEFT[3]!,
          ok: userAgain.ok,
          outcome: userAgain.ok ? '통과' : RECORDED_THEFT[3]!.outcome,
        },
      ]);
      setIsLive(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : '서버에 연결하지 못했어요. 잠시 후 다시 눌러 주세요.',
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className={ui.wide}>
      <div className={styles.storyStage}>
        <BoothScene kickedOut={bothKickedOut} />
        <div className={styles.storySide}>
          <p className={ui.source}>
            {isLive
              ? '방금 실제 서버에서 실행한 결과'
              : `지난 실측 기록 (${RECORDED_AT}, 로컬 MySQL)`}
          </p>
          <ol className={styles.storySteps}>
            {steps.map((step, index) => (
              <li key={index}>
                <span className={styles.stepIndex}>{index + 1}</span>
                <div>
                  <p>{step.title}</p>
                  <p className={index === 0 || step.ok ? ui.source : ui.failText}>{step.outcome}</p>
                </div>
              </li>
            ))}
          </ol>
          <Button size="big" onClick={() => void run()} disabled={isRunning}>
            {isRunning ? '영수증을 복사하는 중…' : '영수증을 복사해서 몰래 써 보기'}
          </Button>
          {error ? (
            <p className={ui.errorLine} role="alert">
              {error}
            </p>
          ) : (
            <p className={ui.hint}>
              실제 서버에 요청을 네 번 보내요. 로그인돼 있지 않으면 데모 계정(아이디 demo, 비밀번호
              demo1234)으로 먼저 들어가요.
            </p>
          )}
        </div>
      </div>
      {bothKickedOut && (
        <Conclusion>
          같은 영수증이 두 번 오면 창구는 누가 진짜 주인인지 따지지 않고, 그 로그인으로 받은
          영수증을 전부 무효로 해요. 그래서 도둑도 손님도 다시 로그인해야 하고, 도둑은 더 버티지
          못해요.
        </Conclusion>
      )}
    </section>
  );
}

/** 재발급 창구 앞의 손님(왼쪽)과 도둑(오른쪽). 둘 다 쫓겨나면 빨간 표시 */
function BoothScene({ kickedOut }: { kickedOut: boolean }) {
  const person = (x: number, label: string, fill: string) => (
    <g>
      <circle cx={x} cy="118" r="16" fill="#fbf8f2" stroke={INK} strokeWidth="2.2" />
      <path
        d={`M${x - 24} 196 Q${x} 128 ${x + 24} 196`}
        fill={fill}
        stroke={INK}
        strokeWidth="2.2"
      />
      <rect
        x={x + 14}
        y="150"
        width="26"
        height="18"
        rx="2"
        fill="#fbf8f2"
        stroke={INK}
        strokeWidth="1.8"
      />
      <path d={`M${x + 18} 156 h18 M${x + 18} 162 h12`} stroke={INK} strokeWidth="1.2" />
      <text x={x} y="222" textAnchor="middle" fontSize="15" fill={INK}>
        {label}
      </text>
      {kickedOut && (
        <g>
          <path
            d={`M${x - 20} 98 l40 40 M${x + 20} 98 l-40 40`}
            stroke={FAIL}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <text x={x} y="244" textAnchor="middle" fontSize="14" fontWeight="700" fill={FAIL}>
            다시 로그인
          </text>
        </g>
      )}
    </g>
  );
  return (
    <svg
      viewBox="0 0 360 260"
      role="img"
      aria-label={
        kickedOut ? '손님과 도둑이 모두 쫓겨난 재발급 창구' : '재발급 창구 앞의 손님과 도둑'
      }
    >
      <g filter="url(#hand-wobble)">
        <rect
          x="130"
          y="40"
          width="100"
          height="110"
          rx="6"
          fill="#ede5d5"
          stroke={INK}
          strokeWidth="2.2"
        />
        <path
          d="M118 42 L180 14 L242 42"
          fill="#f2c7a2"
          stroke={INK}
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <rect
          x="148"
          y="66"
          width="64"
          height="40"
          rx="4"
          fill="#fbf8f2"
          stroke={INK}
          strokeWidth="2"
        />
        <text x="180" y="91" textAnchor="middle" fontSize="14" fontWeight="700" fill={INK}>
          재발급
        </text>
        <path d="M130 150 H230" stroke={INK} strokeWidth="2.2" />
      </g>
      {person(64, '손님', '#bcd4e0')}
      {person(296, '도둑', '#ede5d5')}
    </svg>
  );
}

const RECORDED_RACE: Record<RefreshMode, { refreshCalls: number; loggedOut: boolean }> = {
  naive: { refreshCalls: 5, loggedOut: true },
  'single-flight': { refreshCalls: 1, loggedOut: false },
};

const RACE_COPY: Record<RefreshMode, { title: string; story: string; tradeoff: string }> = {
  naive: {
    title: '각자 줄서기',
    story:
      '밴드가 바랜 걸 알아챈 다섯 명이 각자 같은 영수증을 들고 창구로 가요. 첫 사람이 영수증을 바꾸고 나면, 나머지 넷은 "이미 쓴 영수증"을 낸 셈이에요.',
    tradeoff: '창구는 복사본으로 보고 로그인을 통째로 취소해요.',
  },
  'single-flight': {
    title: '대표 한 명만',
    story:
      '다섯 명 중 한 명만 창구에 가고, 나머지 넷은 그 사람이 새 밴드를 받아 올 때까지 기다렸다가 같이 써요.',
    tradeoff: '창구에는 한 번만 가고, 다섯 요청이 모두 이어서 성공해요.',
  },
};

/** 5명이 동시에 재발급 창구로: 같은 상황을 두 방식으로 실제 실행 */
function RefreshCrowd({
  ensureSession,
  applySession,
  addLog,
  labelFor,
  accessTokenTtlSeconds,
}: StoryProps) {
  const [results, setResults] = useState(RECORDED_RACE);
  const [liveModes, setLiveModes] = useState<RefreshMode[]>([]);
  const [runningMode, setRunningMode] = useState<RefreshMode | null>(null);
  const [error, setError] = useState<{ mode: RefreshMode; message: string } | null>(null);

  const run = async (mode: RefreshMode) => {
    setRunningMode(mode);
    setError(null);
    try {
      if (!(await ensureSession())) throw new Error('데모 계정으로 로그인하지 못했어요.');
      const outcome = await runRefreshRace(mode, accessTokenTtlSeconds, addLog);
      if ('error' in outcome) throw new Error('먼저 로그인이 필요해요. 다시 눌러 주세요.');
      applyRaceOutcome(outcome, applySession, labelFor);
      setResults((current) => ({ ...current, [mode]: outcome.result }));
      setLiveModes((current) => [...new Set([...current, mode])]);
    } catch (caught) {
      setError({
        mode,
        message: caught instanceof Error ? caught.message : '서버에 연결하지 못했어요.',
      });
    } finally {
      setRunningMode(null);
    }
  };

  return (
    <section className={ui.wide}>
      <div className={ui.column}>
        <h2 className={ui.sectionTitle}>5명이 동시에 재발급 창구로</h2>
        <p className={ui.lead}>
          한 화면을 열 때 목록·알림·프로필처럼 요청 다섯 개가 동시에 나가는 일은 흔해요. 그 순간
          손목밴드가 바래 있으면, 다섯 요청이 모두 재발급이 필요해져요.
        </p>
      </div>
      <div className={`${ui.fixes} ${ui.fixesTwo}`}>
        {(['naive', 'single-flight'] as RefreshMode[]).map((mode) => {
          const result = results[mode];
          const copy = RACE_COPY[mode];
          return (
            <article key={mode} className={ui.fix}>
              <h3>{copy.title}</h3>
              <CrowdScene walkers={result.refreshCalls} failed={result.loggedOut} />
              <p>{copy.story}</p>
              <dl className={ui.fixStats}>
                <div>
                  <dt>창구에 간 횟수</dt>
                  <dd className={result.refreshCalls > 1 ? ui.failText : ui.goodText}>
                    {result.refreshCalls}번
                  </dd>
                </div>
                <div>
                  <dt>결과</dt>
                  <dd className={result.loggedOut ? ui.failText : ui.goodText}>
                    {result.loggedOut ? '로그인 취소됨' : '로그인 유지'}
                  </dd>
                </div>
              </dl>
              <p className={ui.tradeoff}>{copy.tradeoff}</p>
              <p className={ui.source}>
                {liveModes.includes(mode)
                  ? '방금 실제 서버에서 실행한 결과'
                  : `지난 실측 기록 (${RECORDED_AT})`}
              </p>
              {mode === 'naive' && (
                <p className={ui.hint}>
                  직접 해 보면 정말로 로그아웃돼요. 다음 버튼이 데모 계정으로 다시 들어가요.
                </p>
              )}
              <Button size="small" onClick={() => void run(mode)} disabled={runningMode !== null}>
                {runningMode === mode ? '실행 중…' : '이 방법으로 직접 실행'}
              </Button>
              {error?.mode === mode && (
                <p className={ui.errorLine} role="alert">
                  {error.message}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** 창구로 걸어가는 사람 수(walkers)와 기다리는 사람. 정적 그림 */
function CrowdScene({ walkers, failed }: { walkers: number; failed: boolean }) {
  return (
    <svg
      viewBox="0 0 300 122"
      className={styles.crowdScene}
      role="img"
      aria-label={`다섯 명 중 ${walkers}명이 창구로 감`}
    >
      <rect
        x="236"
        y="20"
        width="56"
        height="70"
        rx="5"
        fill="#ede5d5"
        stroke={INK}
        strokeWidth="2"
      />
      <text x="264" y="60" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK}>
        창구
      </text>
      {Array.from({ length: 5 }, (_, index) => {
        const isWalking = index < walkers;
        const x = isWalking ? 168 + index * 14 : 24 + index * 24;
        const y = 50 + (index % 2) * 18;
        const isRejected = failed && isWalking && index > 0;
        return (
          <g key={index}>
            <circle
              cx={x}
              cy={y}
              r="8"
              fill={isRejected ? FAIL : isWalking ? '#f2c7a2' : '#bcd4e0'}
              stroke={INK}
              strokeWidth="1.6"
            />
            <path
              d={`M${x - 10} ${y + 30} Q${x} ${y + 6} ${x + 10} ${y + 30}`}
              fill="none"
              stroke={INK}
              strokeWidth="1.6"
            />
          </g>
        );
      })}
      {walkers === 1 && (
        <text x="72" y="118" textAnchor="middle" fontSize="12" fill="#5e564b">
          기다리는 넷
        </text>
      )}
    </svg>
  );
}

/** 새로고침해도 로그인 유지: 이번 페이지 로드에서 실제로 복구됐는지 보여주고, 새로고침을 직접 해 보게 한다 */
function ReloadRecovery({ session, ensureSession, restoreState }: StoryProps) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const statusLine =
    restoreState === 'restoring'
      ? '이 페이지가 열릴 때 영수증을 확인하는 중…'
      : restoreState === 'restored'
        ? '방금 이 페이지를 열 때, 금고 속 영수증으로 새 손목밴드를 받아서 로그인이 그대로 이어졌어요.'
        : '이번에 열 때는 금고에 영수증이 없었어요. 들어간 뒤 새로고침해 보세요.';
  return (
    <section className={ui.column}>
      <h2 className={ui.sectionTitle}>새로고침해도 로그인 유지</h2>
      <p className={ui.lead}>
        손목밴드는 주머니(메모리)에만 넣어 둬서, 새로고침하면 사라져요. 대신 재발급 영수증은
        브라우저 금고(httpOnly 쿠키)에 있어서, 페이지가 열리자마자 창구에 조용히 한 번 다녀와요.
      </p>
      <p
        className={
          restoreState === 'restored'
            ? `${styles.reloadStatus} ${ui.goodText}`
            : styles.reloadStatus
        }
      >
        {statusLine}
      </p>
      {session ? (
        <Button size="small" onClick={() => window.location.reload()}>
          새로고침 해 보기
        </Button>
      ) : (
        <Button
          size="small"
          disabled={isLoggingIn}
          onClick={() => {
            setIsLoggingIn(true);
            void ensureSession().finally(() => setIsLoggingIn(false));
          }}
        >
          데모 계정으로 들어가기
        </Button>
      )}
    </section>
  );
}

const LOCKERS: { kind: StorageKind; title: string; real: string; story: string }[] = [
  {
    kind: 'memory',
    title: '주머니',
    real: '메모리 (자바스크립트 변수)',
    story:
      '내 손에만 있어서 남이 꺼내기 어려워요. 대신 새로고침하면 사라져요. 손목밴드(짧게 쓰는 토큰)를 여기에 둬요.',
  },
  {
    kind: 'localStorage',
    title: '가방',
    real: 'localStorage',
    story: '새로고침해도 남지만, 페이지에서 돌아가는 어떤 스크립트든 열어 볼 수 있어요.',
  },
  {
    kind: 'httpOnlyCookie',
    title: '금고',
    real: 'httpOnly 쿠키',
    story:
      '스크립트는 못 열고, 브라우저가 재발급 창구에 갈 때만 알아서 꺼내 줘요. 재발급 영수증을 여기에 둬요.',
  },
];

/** 어디에 보관할까: 이 브라우저에서 나쁜 스크립트처럼 실제로 읽어 본다 */
function StorageLockers() {
  const [outcomes, setOutcomes] = useState<Record<StorageKind, AttackOutcome> | null>(null);
  return (
    <section className={ui.wide}>
      <div className={ui.column}>
        <h2 className={ui.sectionTitle}>어디에 보관할까</h2>
        <p className={ui.lead}>
          페이지에 나쁜 스크립트가 끼어들었다고 해 볼게요. 버튼을 누르면 이 브라우저에서 그
          스크립트가 할 수 있는 방법으로 세 곳을 실제로 뒤져요. (가방에는 연습용 가짜 손목밴드를
          넣어 두었어요)
        </p>
      </div>
      <div className={ui.fixes}>
        {LOCKERS.map((locker) => {
          const outcome = outcomes?.[locker.kind];
          return (
            <article key={locker.kind} className={ui.fix}>
              <h3>
                {locker.title} <small className={ui.source}>{locker.real}</small>
              </h3>
              <p>{locker.story}</p>
              <p className={outcome ? (outcome.stolen ? ui.failText : ui.goodText) : ui.source}>
                <b>
                  {outcome
                    ? outcome.stolen
                      ? '스크립트가 꺼내 갔어요'
                      : '스크립트가 못 열었어요'
                    : '아직 안 뒤져 봤어요'}
                </b>
              </p>
            </article>
          );
        })}
      </div>
      <div className={styles.lockerAction}>
        <Button size="small" onClick={() => setOutcomes(readTokensLikeXss())}>
          나쁜 스크립트로 뒤져 보기
        </Button>
      </div>
    </section>
  );
}
