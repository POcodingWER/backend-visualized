import Link from 'next/link';
import type { ReactNode } from 'react';
import { CHAPTERS } from '../../lib/site';
import styles from './ui.module.css';

/** 장(chapter) 뼈대: 번호·제목·한 줄 질문 → 본문 → 이전·다음 장 안내 */
export function ChapterLayout({
  chapterNumber,
  title,
  question,
  children,
}: {
  chapterNumber: (typeof CHAPTERS)[number]['number'];
  title: string;
  question: ReactNode;
  children: ReactNode;
}) {
  const previousChapter = CHAPTERS.find((chapter) => chapter.number === chapterNumber - 1);
  const nextChapter = CHAPTERS.find((chapter) => chapter.number === chapterNumber + 1);
  return (
    <main className={styles.page}>
      <header className={styles.column}>
        <p className={styles.eyebrow}>{chapterNumber}장</p>
        <h1 className={styles.title}>
          <span className="highlight">{title}</span>
        </h1>
        <p className={styles.question}>{question}</p>
      </header>
      {children}
      <nav className={styles.nextChapter} aria-label="이전·다음 이야기">
        {nextChapter && (
          <p>
            <span>다음 이야기</span>
            <Link href={nextChapter.href}>
              {nextChapter.number}장 {nextChapter.title} — {nextChapter.subtitle} →
            </Link>
          </p>
        )}
        {previousChapter && (
          <p>
            <span>이전 이야기</span>
            <Link href={previousChapter.href}>
              ← {previousChapter.number}장 {previousChapter.title}
            </Link>
          </p>
        )}
      </nav>
    </main>
  );
}

export type ResultNumber = {
  value: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  tone?: 'fail' | 'good';
};

/** 실측 숫자 묶음. 출처를 반드시 함께 보여준다. */
export function ResultNumbers({ items, source }: { items: ResultNumber[]; source: ReactNode }) {
  return (
    <figure className={styles.numbers}>
      <dl>
        {items.map((item, index) => (
          <div key={index}>
            <dd className={item.tone ? styles[item.tone] : undefined}>{item.value}</dd>
            <dt>{item.label}</dt>
            {item.detail && <dd className={styles.numberDetail}>{item.detail}</dd>}
          </div>
        ))}
      </dl>
      <figcaption>{source}</figcaption>
    </figure>
  );
}

/**
 * "개발자용 자세히": 전문 용어·SQL·DB 상태는 이 안에만 둔다. 네이티브 <details>.
 * ponytail: 닫혀 있어도 children을 렌더한다. 안쪽이 무거워져 첫 화면이 느려지면 open 상태로 지연 렌더할 것.
 */
export function DevDetails({
  description,
  children,
}: {
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className={styles.devDetails} open>
      <summary>
        <b>개발자용 자세히</b>
        {description && <span>{description}</span>}
      </summary>
      <div className={styles.devBody}>{children}</div>
    </details>
  );
}

/** 장 첫머리의 4컷 만화. 각 컷 그림은 viewBox 0 0 240 180 기준 SVG 내용. 데스크톱 4칸, 모바일 2×2. */
export function ComicStrip({
  label,
  panels,
}: {
  label: string;
  panels: { art: ReactNode; caption: ReactNode }[];
}) {
  return (
    <figure className={styles.comic} aria-label={label}>
      <ol>
        {panels.map((panel, index) => (
          <li key={index}>
            <svg viewBox="0 0 240 180" aria-hidden="true" fill="none" filter="url(#hand-wobble)">
              {panel.art}
            </svg>
            <p>
              <span className={styles.comicIndex}>{index + 1}</span>
              {panel.caption}
            </p>
          </li>
        ))}
      </ol>
    </figure>
  );
}
