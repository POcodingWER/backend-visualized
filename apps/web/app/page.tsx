import Image from 'next/image';
import Link from 'next/link';
import { CHAPTERS, DEPLOY_PAGE, GITHUB_URL } from '../lib/site';
import { ResultNumbers } from './components/molecules/ResultNumbers';
import ui from './components/ui.module.css';
import styles from './landing.module.css';
import { buttonClassName } from './components/atoms/Button';
import { INK, inkStroke } from './components/atoms/ink';
import { DevDetails } from './components/molecules/DevDetails';
import { AUTHOR, DECISIONS } from './landing-content';

// API를 부르지 않는 페이지라 빌드할 때 HTML을 미리 만들어 둔다(SSG).
// cookies() · headers()처럼 요청마다 다른 값을 쓰는 코드가 들어오면 빌드가 실패해서 바로 알 수 있다
export const dynamic = 'error';

const ink = { ...inkStroke, strokeWidth: 2.2 };
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
    numberLabel: '더 빨라요 (하나씩 18.7초 → 묶어서 0.29초)',
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
    numberLabel: '데이터베이스에 간 횟수 (매번 → 메뉴판 먼저, 실측)',
  },
  {
    problem: '서버 한 대에 손님이 계속 몰리면, 같은 서버를 하나 더 켜는 것만으로 될까요?',
    number: '7~10초 → 1.9초',
    numberLabel: '손님 800명일 때 느린 쪽 5%가 기다린 시간 (API 1개 → 2개, 처리량은 그대로, 실측)',
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
            티켓팅, 로그인 유지, 클릭 기록, 포인트, 결제, 캐시, 서버 늘리기. 매일 쓰는 기능 뒤에서
            서버가 실수하는 순간을 실제 서버와 데이터베이스에서 일부러 일으켜 보고, 고친 뒤 얼마나
            나아졌는지 숫자로 확인하는 그림책 7편이에요.
          </p>
          <Link href="/ticketing" className={`${buttonClassName.big} ${styles.cta}`}>
            1장 티켓팅부터 보기 →
          </Link>
        </div>
        <svg
          className={styles.heroArt}
          viewBox="0 0 320 280"
          role="img"
          aria-label="휴대폰 버튼 아래로 서버와 데이터베이스가 이어진 그림"
          fill="none"
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
        <h2 className={ui.sectionTitle}>7편의 이야기</h2>
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
        {/* 장 번호 없는 따로 페이지: 7편 목록 밖에 둔다 */}
        <Link href={DEPLOY_PAGE.href} className={styles.extra}>
          <span className={styles.teaserNumber}>번외</span>
          <h3>
            {DEPLOY_PAGE.title} <small>{DEPLOY_PAGE.subtitle}</small>
          </h3>
          <p>
            AWS 가입부터 끊기지 않는 배포, 매일 DB 백업까지. 친 명령 그대로와 막혔던 것, 배운 것을
            적었어요.
          </p>
          <p className={styles.teaserValue}>실패한 요청 0번</p>
          <p className={styles.teaserLabel}>배포 중 0.2초마다 찔러 본 결과 (배포 3번)</p>
        </Link>
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
              label: '“한 번에 처리”가 “줄 세우기”보다 빠름',
              detail: '0.41초 vs 1.70초 (각 3회 중 중간값)',
            },
            {
              value: '65배',
              label: '묶어 보내기가 하나씩 보내기보다 빠름',
              detail: '클릭 기록 10,000개를 서버로: 18.7초 → 0.29초',
            },
            {
              value: '58~72배',
              label: '묶어 저장하기가 하나씩 저장하기보다 빠름',
              detail: '데이터베이스에 10,000줄: 70.4초 → 1.21초, 다시 재면 75.0초 → 1.04초',
            },
          ]}
          source={
            <>
              출처: <a href={docLink('ticketing-coupon.md')}>ticketing-coupon.md</a> ·{' '}
              <a href={docLink('delivery-batching.md')}>delivery-batching.md</a> (맥북 M1 Pro, MySQL
              8.4, 2026-10-19 측정)
            </>
          }
        />
      </section>

      <section className={ui.wide} id="decisions">
        <h2 className={ui.sectionTitle}>7가지 선택</h2>
        <p className={ui.lead}>
          장마다 무엇을 고르고 무엇을 포기했는지, 재 보고 나서 알게 된 것까지 적었어요. 숫자는 모두
          이 저장소의 측정 기록에 있는 값이에요.
        </p>
        <div className={styles.decisions}>
          {DECISIONS.map((decision) => (
            <article key={decision.href}>
              <p className={styles.decisionChapter}>
                <Link href={decision.href}>{decision.chapter}장 보기 →</Link>
              </p>
              <h3>{decision.title}</h3>
              <p className={styles.decisionSummary}>{decision.summary}</p>
              <DevDetails description="고른 것 · 포기한 것 · 배운 것">
                <dl className={styles.decisionDetail}>
                  <dt>선택한 방법과 이유</dt>
                  <dd>
                    <ul>
                      {decision.chose.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </dd>
                  <dt>포기한 방법과 이유</dt>
                  <dd>
                    <ul>
                      {decision.gaveUp.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </dd>
                  <dt>배운 것</dt>
                  <dd>
                    <ul>
                      {decision.learned.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </dd>
                </dl>
              </DevDetails>
            </article>
          ))}
        </div>
        <p className={ui.source}>
          같은 내용을 저장소의{' '}
          <a href={`${GITHUB_URL}/blob/main/docs/decisions.md`}>docs/decisions.md</a>에도 적어
          뒀어요.
        </p>
      </section>

      {/* 자세한 소개는 /about. 옛 /#author 주소로 와도 이 카드에 닿게 id를 남긴다 */}
      <section className={ui.wide} id="author">
        <h2 className={ui.sectionTitle}>About me</h2>
        <Link href="/about" className={styles.authorCard}>
          <Image
            src="/author.jpg"
            width={354}
            height={472}
            alt={AUTHOR.photoAlt}
            className={styles.photo}
            sizes="5rem"
          />
          <span className={styles.authorText}>
            <b className={styles.authorName}>{AUTHOR.name}</b>
            <span>{AUTHOR.intro}</span>
            <small>{AUTHOR.career}</small>
            <span className={styles.authorMore}>왜 백엔드로, 경력, 글 · 활동, 연락처 보기 →</span>
          </span>
        </Link>
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
            <small>Docker · 같은 EC2</small>
          </li>
        </ol>
        <ul className={styles.facts}>
          <li>
            자동 테스트 72개 — API 51개(실제 MySQL·Redis로 동시성 검증 포함), 화면 19개, 이벤트 SDK
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
            Turborepo 모노레포). 한 일과 회고는{' '}
            <Link href={DEPLOY_PAGE.href}>{DEPLOY_PAGE.title}</Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
