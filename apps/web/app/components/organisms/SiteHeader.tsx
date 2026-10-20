'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CHAPTERS } from '../../../lib/site';
import styles from '../ui.module.css';

export default function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.wordmark}>
        버튼 하나 뒤에서
      </Link>
      {/* 좁은 화면에선 장 링크가 여러 줄로 접힌다 (ui.module.css .nav) */}
      <nav aria-label="이야기 목록" className={styles.nav}>
        {CHAPTERS.map((chapter) => (
          <Link
            key={chapter.href}
            href={chapter.href}
            aria-current={pathname.startsWith(chapter.href) ? 'page' : undefined}
          >
            <span className={styles.navNumber}>{chapter.number}</span> {chapter.title}
          </Link>
        ))}
        <Link href="/#author">About me</Link>
      </nav>
    </header>
  );
}
