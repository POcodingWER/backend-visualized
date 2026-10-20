import Link from 'next/link';
import type { ReactNode } from 'react';
import { CHAPTERS } from '../../../lib/site';
import styles from '../ui.module.css';

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
