import Link from 'next/link';
import { CHAPTERS, GITHUB_URL } from '../lib/site';
import { ResultNumbers } from './components/ui';
import ui from './components/ui.module.css';
import styles from './landing.module.css';

const INK = '#2b2620';
// 채움은 <svg fill="none">에서 물려받는다
const ink = {
  stroke: INK,
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
const docLink = (file: string) => `${GITHUB_URL}/blob/main/docs/benchmarks/${file}`;

const TEASERS = [
  {
    problem: '표는 100장인데 500명이 동시에 누르면, 서버는 몇 장을 팔까요?',
    number: '400장 → 0장',
    numberLabel: '더 팔린 표 (고치기 전 → 후)',
  },
  {
    problem: '로그인이 만료된 순간 요청 5개가 동시에 나가면, 새 손목밴드를 몇 번 받으러 갈까요?',
    number: '5번 → 1번',
    numberLabel: '재발급 창구에 간 횟수 (동시 요청 5개, 실측)',
  },
  {
    problem: '클릭 기록 10,000개를 하나씩 보내는 것과 100개씩 묶어 보내는 것, 얼마나 다를까요?',
    number: '65배',
    numberLabel: '빨라짐 (18.7초 → 0.29초)',
  },
  {
    problem: '포인트 적립·사용 200건이 동시에 몰리면, 잔액은 맞을까요?',
    number: '10,100P',
    numberLabel: '잔액 숫자만 고칠 때 사라진 포인트 (실측)',
  },
  {
    problem: '결제 버튼을 연달아 누르고 앱이 알아서 다시 보내면, 돈은 몇 번 빠져나갈까요?',
    number: '4번 → 1번',
    numberLabel: '결제된 횟수 (번호표 없이 → 함께, 실측)',
  },
  {
    problem: '손님 1000명이 같은 메뉴를 물어보면, 데이터베이스에 몇 번 가야 할까요?',
    number: '1000번 → 1번',
    numberLabel: 'DB 읽기 (매번 → Redis 대기판, 실측)',
  },
];

const DECISIONS = [
  {
    title: '선착순 재고: 잠금 대신 조건부 UPDATE 한 문장',
    chose: '“남았으면 1 늘리기”를 UPDATE … WHERE issued < total 한 문장으로 DB에 맡겼어요.',
    gave: '1인 1매 같은 복잡한 규칙은 이 한 문장에 못 담아요. 그땐 unique 제약을 같이 쓰거나 잠금으로 가야 해요.',
    because:
      '같은 조건에서 행 잠금(1.70초)보다 약 4배 빠르고(0.41초) 초과 판매 0. 코드도 가장 짧았어요.',
  },
  {
    title: '로그인 유지: 액세스 토큰은 메모리, 리프레시 토큰은 httpOnly 쿠키',
    chose:
      '짧게 사는 액세스 토큰은 자바스크립트 변수에만, 오래 사는 리프레시 토큰은 스크립트가 못 읽는 쿠키에 두었어요.',
    gave: '새로고침하면 메모리가 비어서 매번 조용히 다시 받아야 해요(silent refresh). 동시에 여러 요청이 만료를 만나면 한 번만 갱신하도록 묶는 코드(single-flight)가 필요했어요.',
    because:
      'localStorage에 두면 XSS 한 번에 토큰이 통째로 새요. 도난 시나리오는 2장에서 직접 재현해요.',
  },
  {
    title: '클릭 기록: 바로 저장 대신 모아서 한 번에',
    chose:
      'SDK가 이벤트를 모았다가 100개 또는 10초마다 한 번에 보내고, 서버는 한 문장(createMany)으로 넣어요.',
    gave: '기록이 화면에 최대 10초 늦게 보여요. 한 묶음이 실패하면 100개가 함께 실패해서, SDK가 묶음 단위로 다시 보내요.',
    because: '같은 10,000개를 보내는 데 18.7초 → 0.29초. 요청 수가 1/100로 줄었어요.',
  },
];

export default function Home() {
  return (
    <main className={ui.page}>
      <section className={styles.hero}>
        <div>
          <p className={ui.eyebrow}>매일 쓰는 기능 뒤의 서버 이야기</p>
          <h1 className={styles.heroTitle}>
            버튼 하나 뒤에서 <span className="highlight">벌어지는 일</span>
          </h1>
          <p className={styles.heroLead}>
            티켓팅, 로그인 유지, 클릭 기록, 포인트, 결제, 캐시. 서버가 실수하는 순간을 진짜 서버와
            데이터베이스에서 직접 일으켜 보고, 고친 결과를 잰 숫자로 확인하는 여섯 편의
            그림책이에요.
          </p>
          <Link href="/ticketing" className={`${ui.bigButton} ${styles.cta}`}>
            1장 티켓팅부터 보기 →
          </Link>
        </div>
        <svg
          className={styles.heroArt}
          viewBox="0 0 320 280"
          role="img"
          aria-label="휴대폰 버튼 아래로 서버와 데이터베이스가 이어진 그림"
          fill="none"
          filter="url(#hand-wobble)"
        >
          <rect x="105" y="10" width="110" height="150" rx="16" fill="#fbf8f2" {...ink} />
          <rect x="125" y="96" width="70" height="30" rx="8" fill="#f2c7a2" {...ink} />
          <text x="160" y="116" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK}>
            예매
          </text>
          <path
            d="M132 40 H188 M132 56 H172 M132 72 H180"
            {...ink}
            strokeWidth="1.6"
            stroke="#b9ac95"
          />
          <path d="M160 160 V196" {...ink} strokeDasharray="4 5" />
          <rect x="40" y="196" width="104" height="58" rx="8" fill="#bcd4e0" {...ink} />
          <path d="M56 214 H128 M56 230 H110" {...ink} strokeWidth="1.6" />
          <text x="92" y="272" textAnchor="middle" fontSize="12" fill="#5e564b">
            서버
          </text>
          <path d="M144 225 H176" {...ink} strokeDasharray="4 5" />
          <ellipse cx="226" cy="204" rx="46" ry="12" fill="#b4c9a9" {...ink} />
          <path d="M180 204 V244 Q226 268 272 244 V204" fill="#b4c9a9" {...ink} />
          <path d="M180 222 Q226 244 272 222" {...ink} strokeWidth="1.6" />
          <text x="226" y="276" textAnchor="middle" fontSize="12" fill="#5e564b">
            데이터베이스
          </text>
        </svg>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>여섯 편의 이야기</h2>
        <ol className={styles.teasers}>
          {CHAPTERS.map((chapter, index) => {
            const teaser = TEASERS[index]!;
            return (
              <li key={chapter.href}>
                <Link href={chapter.href} className={styles.teaser}>
                  <span className={styles.teaserNumber}>{chapter.number}장</span>
                  <h3>
                    {chapter.title} <small>{chapter.subtitle}</small>
                  </h3>
                  <p>{teaser.problem}</p>
                  <p className={styles.teaserValue}>{teaser.number}</p>
                  <p className={styles.teaserLabel}>{teaser.numberLabel}</p>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>숫자로 본 결과</h2>
        <p className={ui.lead}>
          모두 이 저장소의 측정 기록에 있는 숫자예요. 노트북 한 대에서 잰 상대 비교라 실행마다 ±30%
          정도 흔들려요.
        </p>
        <ResultNumbers
          items={[
            {
              value: '400 → 0',
              tone: 'good',
              label: '초과 판매된 표',
              detail: '100장에 500명 동시 예매. 고치기 전 vs 세 가지 해결책 모두',
            },
            {
              value: '약 4배',
              label: '한 번에 처리 vs 줄 세우기',
              detail: '0.41초 vs 1.70초 (각 3회 중 중간값)',
            },
            {
              value: '65배',
              label: '묶어 보내기 vs 하나씩 보내기',
              detail: '이벤트 10,000개, HTTP 18.7초 → 0.29초',
            },
            {
              value: '58~72배',
              label: '묶어 저장 vs 하나씩 저장',
              detail: 'DB에 10,000행: 70.4초 → 1.21초 (1회차)',
            },
          ]}
          source={
            <>
              출처: <a href={docLink('stage3-coupon.md')}>stage3-coupon.md</a> ·{' '}
              <a href={docLink('stage2-ingest.md')}>stage2-ingest.md</a> (맥북 M1 Pro, MySQL 8.4,
              2026-10-19 측정)
            </>
          }
        />
      </section>

      <section className={ui.wide} id="author">
        <h2 className={ui.sectionTitle}>만든 사람</h2>
        <div className={styles.author}>
          {/* TODO(author): 사진 */}
          <div className={styles.photoPlaceholder} aria-label="사진 자리 (준비 중)">
            사진
          </div>
          <div className={styles.authorText}>
            {/* TODO(author): 이름 */}
            <p className={styles.authorName}>
              <span className={styles.todo}>이름</span>
            </p>
            <p>
              4년 동안 프론트엔드 개발을 하다가, 버튼 뒤에서 무슨 일이 일어나는지 직접 만들어 보고
              싶어 풀스택으로 넘어가는 중이에요. 이 사이트는 화면(Next.js)부터 서버(NestJS),
              데이터베이스(MySQL), 배포 설정까지 혼자 만들었어요.
            </p>
            <p className={styles.authorLinks}>
              <a href={GITHUB_URL}>GitHub 저장소</a>
              {/* TODO(author): 이력서 링크, 연락처 */}
              <span className={styles.todo}>이력서</span>
              <span className={styles.todo}>연락처</span>
            </p>
          </div>
        </div>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>고민했던 선택 세 가지</h2>
        <p className={ui.lead}>무엇을 얻으려고 무엇을 포기했는지.</p>
        <div className={styles.decisions}>
          {DECISIONS.map((decision) => (
            <article key={decision.title}>
              <h3>{decision.title}</h3>
              <dl>
                <dt>고른 것</dt>
                <dd>{decision.chose}</dd>
                <dt>포기한 것</dt>
                <dd>{decision.gave}</dd>
                <dt>그래도 고른 이유</dt>
                <dd>{decision.because}</dd>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>어떻게 만들었나</h2>
        <ol className={styles.stack} aria-label="구성도">
          <li>
            <b>브라우저</b>
            <span>Next.js 15 · React 19</span>
            <small>Vercel</small>
          </li>
          <li aria-hidden="true" className={styles.arrow}>
            →
          </li>
          <li>
            <b>API 서버</b>
            <span>NestJS 11 · Prisma 6</span>
            <small>Docker · EC2 · Caddy(HTTPS)</small>
          </li>
          <li aria-hidden="true" className={styles.arrow}>
            →
          </li>
          <li>
            <b>데이터베이스 · 캐시</b>
            <span>MySQL 8 · Redis 7</span>
            <small>RDS · Docker</small>
          </li>
        </ol>
        <ul className={styles.facts}>
          <li>
            자동 테스트 46개 — API 40개(실제 MySQL·Redis로 동시성 검증 포함), 화면 4개, 이벤트 SDK
            2개
          </li>
          <li>
            GitHub Actions: 커밋마다 포맷 → 타입 검사 → 린트 → 테스트 → 빌드 → 운영 모드 API 스모크
            테스트, Docker 이미지 빌드
          </li>
          <li>남용 방지: IP당 요청 제한, 시뮬레이션 동시 실행 1개 + 쿨다운, 관리자 API 키</li>
          <li>
            배포 구성은 저장소의{' '}
            <a href={`${GITHUB_URL}/blob/main/docs/deploy.md`}>docs/deploy.md</a>에 있어요 (pnpm +
            Turborepo 모노레포)
          </li>
        </ul>
      </section>
    </main>
  );
}
