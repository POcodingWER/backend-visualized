import Image from 'next/image';
import Link from 'next/link';
import { DEPLOY_PAGE, GITHUB_URL } from '../../lib/site';
import { buttonClassName } from '../components/atoms/Button';
import { ResultNumbers } from '../components/molecules/ResultNumbers';
import ui from '../components/ui.module.css';
import { AUTHOR, DECISIONS, type TextLink } from '../landing-content';
import styles from './about.module.css';

export const metadata = {
  title: `About me · ${AUTHOR.name} — 버튼 하나 뒤에서`,
};

/** 장 번호 없는 따로 페이지. 글은 모두 landing-content.ts의 AUTHOR에서 온다 */
export default function AboutPage() {
  return (
    <main className={ui.page}>
      <header className={`${ui.wide} ${styles.intro}`}>
        <Image
          src="/author.jpg"
          width={354}
          height={472}
          alt={AUTHOR.photoAlt}
          className={styles.photo}
          sizes="(max-width: 640px) 7rem, 11rem"
          priority
        />
        <div className={styles.introText}>
          <p className={ui.eyebrow}>About me</p>
          <h1 className={ui.title}>
            <span className="highlight">{AUTHOR.name}</span>
          </h1>
          <p className={styles.lead}>{AUTHOR.intro}</p>
          <p className={ui.source}>{AUTHOR.career}</p>
          <p className={styles.buttons}>
            <a href={AUTHOR.resumeUrl} className={buttonClassName.small}>
              이력서 보기
            </a>
            <a href="https://github.com/POcodingWER">GitHub</a>
            <a href="https://pocodingwer.github.io">블로그</a>
          </p>
        </div>
      </header>

      <section className={ui.column}>
        <h2 className={ui.sectionTitle}>왜 백엔드로</h2>
        <div className={styles.why}>
          {AUTHOR.whyBackend.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>기술 스택</h2>
        <dl className={styles.stack}>
          {AUTHOR.stack.map(({ group, items }) => (
            <div key={group}>
              <dt>{group}</dt>
              <dd>
                <ul>
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>이 프로젝트에서 한 것</h2>
        <p className={ui.lead}>{AUTHOR.builtHere}</p>
        <ol className={styles.chapters}>
          {DECISIONS.map((decision) => (
            <li key={decision.href}>
              <Link href={decision.href}>
                <span className={styles.chapterNumber}>{decision.chapter}장</span>
                <b>{decision.title}</b>
                <span>{decision.summary}</span>
              </Link>
            </li>
          ))}
        </ol>
        <Link href={DEPLOY_PAGE.href} className={styles.extra}>
          <span className={styles.chapterNumber}>번외</span>
          <b>{DEPLOY_PAGE.title}</b>
          <span>
            AWS 가입부터 끊기지 않는 배포(배포 중 실패한 요청 0번), 매일 DB 백업까지 혼자 한 기록
          </span>
        </Link>
        <h3 className={styles.subTitle}>회사 경험이 이 사이트의 장으로</h3>
        <ul className={styles.list}>
          {AUTHOR.bridges.map((bridge) => (
            <li key={bridge.text}>
              {bridge.text}{' '}
              {bridge.links.map((link) => (
                <TextLinkTo key={link.href} link={link} />
              ))}
            </li>
          ))}
        </ul>
        <p className={ui.source}>
          장마다 고른 것·포기한 것·배운 것은{' '}
          <Link href="/#decisions">첫 화면의 여섯 장의 선택</Link>과 저장소{' '}
          <a href={GITHUB_URL}>POcodingWER/backend-visualized</a>에 있어요.
        </p>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>경력</h2>
        <ol className={styles.timeline}>
          {AUTHOR.timeline.map((job) => (
            <li key={job.period}>
              <p className={styles.period}>{job.period}</p>
              <h3>
                {job.role} <small>{job.place}</small>
              </h3>
              <p>{job.summary}</p>
              <ul className={styles.list}>
                {job.projects.map((project) => (
                  <li key={project}>{project}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <div className={styles.highlights}>
          <ResultNumbers
            items={AUTHOR.highlights}
            source={
              <>
                회사에서 낸 숫자예요. 출처: <a href={AUTHOR.resumeUrl}>이력서</a>
              </>
            }
          />
        </div>
        <h3 className={styles.subTitle}>끝까지 파고든 문제</h3>
        <ul className={styles.list}>
          {AUTHOR.ownership.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>글 · 활동</h2>
        <div className={styles.writing}>
          {AUTHOR.writing.map(({ group, posts }) => (
            <div key={group}>
              <h3>{group}</h3>
              <ul className={styles.list}>
                {posts.map((post) => (
                  <li key={post.href}>
                    <a href={post.href}>{post.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h3>공모전</h3>
            <p>
              {AUTHOR.contest.text} <a href={AUTHOR.contest.href}>PlayMCP에서 보기 →</a>
            </p>
          </div>
        </div>
      </section>

      <section className={ui.column}>
        <h2 className={ui.sectionTitle}>연락처</h2>
        <ul className={styles.contact}>
          {AUTHOR.links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
          <li>
            <a href={AUTHOR.resumeUrl}>웹 이력서</a>
          </li>
        </ul>
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

/** 이 사이트의 장(/…)은 Link, 바깥 주소는 a */
function TextLinkTo({ link }: { link: TextLink }) {
  const text = `${link.label} →`;
  return (
    <span className={styles.chapterLink}>
      {link.href.startsWith('/') ? (
        <Link href={link.href}>{text}</Link>
      ) : (
        <a href={link.href}>{text}</a>
      )}
    </span>
  );
}
