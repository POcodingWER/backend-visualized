import Link from 'next/link';
import { DEPLOY_PAGE, githubFile } from '../../lib/site';
import { Conclusion } from '../components/atoms/Conclusion';
import { INK, inkStroke } from '../components/atoms/ink';
import { ResultNumbers } from '../components/molecules/ResultNumbers';
import { ComicStrip } from '../components/organisms/ComicStrip';
import ui from '../components/ui.module.css';
import { REASONS, RESTORE_ROWS, RETRO, TROUBLES } from './content';
import { BlueGreenDetails } from './BlueGreenDetails';
import { PipelineDiagram, RuntimeDiagram } from './Diagrams';
import { DEPLOY_STEPS } from './steps';
import { withCode } from '../../lib/inline-code';
import styles from './deploy.module.css';

export const metadata = {
  title: `${DEPLOY_PAGE.title}: ${DEPLOY_PAGE.subtitle} — 버튼 하나 뒤에서`,
};

/** 측정 출처: GitHub Actions Deploy 실행 기록 + 맥에서 0.2초마다 /health (2026-10-21) */
const ACTIONS_RUNS =
  'https://github.com/POcodingWER/backend-visualized/actions/workflows/deploy.yml';

function Server({ x, y, fill = '#bcd4e0' }: { x: number; y: number; fill?: string }) {
  return (
    <g>
      <rect x={x} y={y} width="56" height="44" rx="6" fill={fill} {...inkStroke} />
      <path d={`M${x + 10} ${y + 14} H${x + 46} M${x + 10} ${y + 28} H${x + 34}`} {...inkStroke} />
    </g>
  );
}

const PANELS = [
  {
    caption: 'AWS에서 작은 컴퓨터 한 대를 빌려요. 돈이 새지 않게 알림부터 걸어요.',
    art: (
      <g>
        <path
          d="M40 92 Q36 60 70 62 Q80 36 112 46 Q140 28 160 56 Q196 54 192 88 Z"
          fill="#fbf8f2"
          {...inkStroke}
        />
        <Server x={92} y={96} />
        <path d="M120 62 V94" {...inkStroke} strokeDasharray="3 4" />
        <circle cx="196" cy="130" r="18" fill="#f2c7a2" {...inkStroke} />
        <text x="196" y="135" textAnchor="middle" fontSize="14" fontWeight="800" fill={INK}>
          $
        </text>
        <path d="M184 104 l6 8 M208 104 l-6 8" {...inkStroke} />
      </g>
    ),
  },
  {
    caption: '문지기(Caddy)가 자물쇠(HTTPS)를 걸고, 열린 문은 두 개(80/443)만 남겨요.',
    art: (
      <g>
        <rect x="40" y="40" width="160" height="110" rx="6" fill="#ede5d5" {...inkStroke} />
        <rect x="104" y="80" width="34" height="70" rx="3" fill="#fbf8f2" {...inkStroke} />
        <rect x="112" y="96" width="18" height="14" rx="2" fill="#f2c7a2" {...inkStroke} />
        <path d="M115 96 V90 a6 6 0 0 1 12 0 V96" {...inkStroke} />
        <text x="72" y="70" textAnchor="middle" fontSize="12" fontWeight="700" fill={INK}>
          443
        </text>
        <text x="170" y="70" textAnchor="middle" fontSize="12" fill="#a3321f">
          3306 ✕
        </text>
      </g>
    ),
  },
  {
    caption: '주방을 둘(blue/green) 두고, 새 주방이 준비되면 손님 길만 바꿔요. 끊기지 않아요.',
    art: (
      <g>
        <Server x={30} y={90} fill="#bcd4e0" />
        <Server x={154} y={90} fill="#b4c9a9" />
        <text x="58" y="152" textAnchor="middle" fontSize="12" fill="#5e564b">
          blue
        </text>
        <text x="182" y="152" textAnchor="middle" fontSize="12" fill="#5e564b">
          green
        </text>
        <path d="M120 30 V58 Q120 70 150 84" {...inkStroke} />
        <path d="M120 58 Q120 70 90 84" {...inkStroke} strokeDasharray="3 4" />
        <path d="M144 76 l8 8 l-10 2" {...inkStroke} />
        <circle cx="120" cy="24" r="8" fill="#fbf8f2" {...inkStroke} />
      </g>
    ),
  },
  {
    caption: '매일 새벽 4시, 장부(DB)를 통째로 복사해 두고 진짜 되살아나는지도 확인해요.',
    art: (
      <g>
        <path d="M196 26 a16 16 0 1 0 14 24 a12 12 0 1 1 -14 -24 Z" fill="#f2c7a2" {...inkStroke} />
        <ellipse cx="74" cy="80" rx="34" ry="9" fill="#b4c9a9" {...inkStroke} />
        <path d="M40 80 V126 Q74 144 108 126 V80" fill="#b4c9a9" {...inkStroke} />
        <path d="M118 104 H148" {...inkStroke} />
        <path d="M140 96 l8 8 l-8 8" {...inkStroke} />
        <rect x="156" y="78" width="54" height="56" rx="4" fill="#ede5d5" {...inkStroke} />
        <text x="183" y="112" textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
          04:00
        </text>
      </g>
    ),
  },
];

export default function DeployPage() {
  return (
    <main className={`${ui.page} ${ui.codeChips}`}>
      <header className={ui.column}>
        <p className={ui.eyebrow}>번외 · 장 번호 없음</p>
        <h1 className={ui.title}>
          <span className="highlight">{DEPLOY_PAGE.title}</span>
        </h1>
        <p className={ui.question}>
          서버를 한 번도 만져 본 적 없는 프론트엔드 개발자가, 이 사이트의 API를 AWS에 올리고 끊기지
          않게 배포하기까지. 한 일을 순서대로, 친 명령 그대로, 그리고 왜 그렇게 했는지 적었어요.
        </p>
      </header>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>1. 그림으로 보는 구조</h2>
        <p className={ui.lead}>
          제가 만든 서버의 모습이에요. 화면은 Vercel, API · DB · 캐시는 AWS 서버 한 대에 있고, 새
          버전을 올리는 동안에도 손님 요청은 끊기지 않아요.
        </p>
        <h3 className={styles.diagramTitle}>지금 돌아가는 모습 + 끊기지 않는 배포</h3>
        <RuntimeDiagram />
        <BlueGreenDetails />
        <h3 className={styles.diagramTitle}>main에 push하면 일어나는 일</h3>
        <PipelineDiagram />
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>2. 숫자로 본 결과</h2>
        <ResultNumbers
          items={[
            {
              value: '약 1분 10초',
              tone: 'good',
              label: 'push 뒤 배포 끝까지 (Actions의 Deploy 전체)',
              detail:
                '이미지 굽기 + 서버 배포. API 코드가 바뀌면 2분 23초. 서버 배포 job은 135초 → 37~51초 (예전엔 job 하나로 전체 2분 18초)',
            },
            {
              value: '0번',
              tone: 'good',
              label: '배포 중 실패한 요청',
              detail: '배포 3번 동안 0.2초마다 862 · 705 · 565번 요청',
            },
            {
              value: '869MiB',
              label: '배포 중 최고 메모리 (전체 1836MiB)',
              detail: '두 색이 잠깐 같이 떠 있을 때. 스왑 변화 없음',
            },
            {
              value: '매일 04:00',
              label: 'DB 백업 (서버 + S3)',
              detail: '12K, 0.3초. 서버 7일 + S3 30일. 임시 DB에 복원해서 11개 테이블 행 수 일치',
            },
          ]}
          source={
            <>
              2026-10-21 측정. 배포 시간은 <a href={ACTIONS_RUNS}>GitHub Actions Deploy 기록</a>,
              요청은 맥에서 <code>https://3-35-59-193.sslip.io/health</code>를 0.2초마다 부른 결과,
              메모리는 서버에서 1초마다 <code>free -m</code>.
            </>
          }
        />
      </section>

      <section className={ui.wide}>
        <ComicStrip label="4컷 만화: 서버를 빌려서 끊기지 않게 배포하기까지" panels={PANELS} />
      </section>

      <section className={ui.column}>
        <h2 className={ui.sectionTitle}>3. 순서대로</h2>
        <p className={ui.lead}>
          가입부터 매일 백업까지 한 일이에요. 앞의 세 단계는 브라우저(AWS 콘솔)에서, 그다음부터는
          대부분 터미널에서 했어요. 단계마다 &quot;실행한 명령어 보기&quot;를 열면 친 그대로 나와요.
          비밀번호 · 토큰 · 서버 설정 파일의 값은 전부 <code>&lt;가림&gt;</code>으로 바꿨어요.
        </p>
        <ol className={styles.roadmap}>
          {DEPLOY_STEPS.map((step, index) => (
            <li key={step.title} id={`step-${index + 1}`}>
              <p className={styles.roadTitle}>
                <b>{withCode(step.title)}</b>
                {step.reason && (
                  <a href={`#reason-${step.reason}`} className={styles.whyChip}>
                    왜 이렇게? →
                  </a>
                )}
              </p>
              <div className={styles.roadBody}>
                <p>{withCode(step.plain)}</p>
                <details className={styles.fold}>
                  <summary>실행한 명령어 보기</summary>
                  <div className={styles.foldBody}>
                    {step.commands.map((block, blockIndex) => (
                      <figure key={blockIndex} className={styles.terminal}>
                        <figcaption>{block.where}</figcaption>
                        <pre tabIndex={0}>
                          <code>{block.code}</code>
                        </pre>
                      </figure>
                    ))}
                    {step.result && <p className={styles.result}>결과 · {withCode(step.result)}</p>}
                  </div>
                </details>
              </div>
            </li>
          ))}
        </ol>
        <p className={ui.source}>
          전체 설명은 저장소의 <a href={githubFile('docs/deploy.md')}>docs/deploy.md</a>, 스크립트는{' '}
          <a href={githubFile('deploy/deploy.sh')}>deploy/deploy.sh</a> ·{' '}
          <a href={githubFile('deploy/backup-mysql.sh')}>deploy/backup-mysql.sh</a> ·{' '}
          <a href={githubFile('.github/workflows/deploy.yml')}>.github/workflows/deploy.yml</a>
        </p>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>4. 왜 이렇게 했나</h2>
        <div className={styles.reasons}>
          {REASONS.map((reason) => {
            const step = DEPLOY_STEPS.findIndex((item) => item.reason === reason.id) + 1;
            return (
              <article key={reason.id} id={`reason-${reason.id}`}>
                <h3>{withCode(reason.question)}</h3>
                <p>{withCode(reason.answer)}</p>
                {reason.cost && (
                  <p className={styles.cost}>
                    <b>대신 떠안은 것</b> {withCode(reason.cost)}
                  </p>
                )}
                {step > 0 && (
                  <a href={`#step-${step}`} className={styles.backLink}>
                    ↑ {step}단계로 돌아가기
                  </a>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>5. DB 백업은 언제, 어떻게</h2>
        <div className={styles.backup}>
          <dl className={styles.facts}>
            <div>
              <dt>언제</dt>
              <dd>
                매일 04:00 (한국 시간). 서버 시계가 <code>Asia/Seoul</code>이라 cron의 4시가 곧 새벽
                4시예요.
              </dd>
            </div>
            <div>
              <dt>무엇을</dt>
              <dd>
                <code>backend_visualized</code> DB 전체를 <code>mysqldump</code>로. 테이블을 잠그지
                않아서 백업 중에도 사이트는 그대로예요.
              </dd>
            </div>
            <div>
              <dt>어디에</dt>
              <dd>
                서버의 <code>/opt/backend-visualized/backups/</code>, 파일 이름에 한국 시간. 나만
                읽을 수 있게(<code>chmod 600</code>) 저장하고 7일 지난 건 지워요.
              </dd>
            </div>
            <div>
              <dt>서버 밖에도</dt>
              <dd>
                S3 버킷 <code>backend-visualized-db-backups</code>의 <code>mysql/</code> 폴더에도
                매일 한 부씩 올라가요. 버전 관리를 켜 두고 30일 뒤 지워요. 서버 역할은{' '}
                <b>올리기만</b> 할 수 있어서, 서버가 털려도 S3의 백업을 읽거나 지울 수 없어요.
              </dd>
            </div>
          </dl>
          <figure className={styles.restore}>
            <figcaption>
              복원 테스트: 가장 최근 백업을 임시 DB에 되살려서 운영 DB와 테이블마다 행 수를 셌어요
              (2026-10-21 09:41). 다 센 뒤 임시 DB는 지웠어요.
            </figcaption>
            <table>
              <thead>
                <tr>
                  <th scope="col">테이블</th>
                  <th scope="col">운영 DB</th>
                  <th scope="col">복원한 DB</th>
                </tr>
              </thead>
              <tbody>
                {RESTORE_ROWS.map(([table, rows]) => (
                  <tr key={table}>
                    <th scope="row">
                      <code>{table}</code>
                    </th>
                    <td>{rows}</td>
                    <td>{rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        </div>
        <Conclusion isGood>
          11개 테이블 모두 행 수가 같았어요. 백업은 "있다"가 아니라 "되살아난다"까지 봐야 해요.
        </Conclusion>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>6. 막혔던 것들</h2>
        <ol className={styles.troubles}>
          {TROUBLES.map((trouble) => (
            <li key={trouble.symptom}>
              <h3>{withCode(trouble.symptom)}</h3>
              <dl>
                <dt>왜</dt>
                <dd>{withCode(trouble.cause)}</dd>
                <dt>어떻게</dt>
                <dd>{withCode(trouble.fix)}</dd>
              </dl>
            </li>
          ))}
        </ol>
      </section>

      <section className={ui.column}>
        <h2 className={ui.sectionTitle}>7. 회고</h2>
        <div className={styles.retro}>
          <p>
            저는 4년 가까이 프론트엔드만 했어요. 서버는 &quot;API 주소&quot;로만 알고 있었고, 배포는
            버튼을 누르면 되는 일이었어요. 이번에 처음으로 그 버튼 뒤를 직접 만들었어요.
          </p>
          <h3>어려웠던 것</h3>
          <ul>
            {RETRO.hard.map((line) => (
              <li key={line}>{withCode(line)}</li>
            ))}
          </ul>
          <h3>프론트엔드 개발자로서 배운 것</h3>
          <ul>
            {RETRO.learned.map((line) => (
              <li key={line}>{withCode(line)}</li>
            ))}
          </ul>
          <h3>다음에 할 것</h3>
          <ul>
            {RETRO.next.map((line) => (
              <li key={line}>{withCode(line)}</li>
            ))}
          </ul>
          <p className={ui.source}>— 임철순</p>
        </div>
      </section>

      <nav className={ui.nextChapter} aria-label="다른 이야기">
        <p>
          <span>여섯 편의 이야기로</span>
          <Link href="/ticketing">1장 티켓팅 — 선착순에 몰린 500명 →</Link>
        </p>
        <p>
          <span>처음으로</span>
          <Link href="/">← 버튼 하나 뒤에서</Link>
        </p>
      </nav>
    </main>
  );
}
