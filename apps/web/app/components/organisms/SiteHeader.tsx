'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CHAPTERS, DEPLOY_PAGE } from '../../../lib/site';
import styles from '../ui.module.css';

export default function SiteHeader() {
  const pathname = usePathname();
  // 좁은 화면에서만 쓰는 목록 열림 상태. 넓은 화면은 CSS가 늘 펼쳐 둔다
  const [open, setOpen] = useState(false);

  // 다른 장으로 넘어가면 목록을 닫는다
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className={styles.header}>
      <div className={styles.headerBar}>
        <Link href="/" className={styles.wordmark}>
          버튼 하나 뒤에서
        </Link>
        <button
          type="button"
          className={styles.navToggle}
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((value) => !value)}
        >
          <span className={styles.navToggleIcon} aria-hidden="true" data-open={open} />
          {open ? '닫기' : '목록'}
        </button>
      </div>
      {/* 좁은 화면에선 '목록' 버튼으로 펼치고 접는다 (ui.module.css .nav) */}
      <nav id="site-nav" aria-label="이야기 목록" className={styles.nav} data-open={open}>
        {CHAPTERS.map((chapter) => (
          <Link
            key={chapter.href}
            href={chapter.href}
            aria-current={pathname.startsWith(chapter.href) ? 'page' : undefined}
          >
            <span className={styles.navNumber}>{chapter.number}</span> {chapter.title}
          </Link>
        ))}
        <Link
          href={DEPLOY_PAGE.href}
          aria-current={pathname.startsWith(DEPLOY_PAGE.href) ? 'page' : undefined}
        >
          {DEPLOY_PAGE.title}
        </Link>
        <Link href="/about" aria-current={pathname.startsWith('/about') ? 'page' : undefined}>
          About me
        </Link>
      </nav>
    </header>
  );
}
