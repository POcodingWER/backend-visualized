import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GITHUB_URL } from '../lib/site';
import './globals.css';
import SiteHeader from './components/organisms/SiteHeader';
import styles from './components/ui.module.css';

export const metadata: Metadata = {
  title: '버튼 하나 뒤에서 — 매일 쓰는 기능 뒤의 서버 이야기',
  description:
    '티켓팅, 로그인 유지, 클릭 기록. 서버가 실수하는 순간을 직접 일으키고, 고친 결과를 실측 숫자로 보여주는 인터랙티브 그림책.',
};

export const viewport: Viewport = { themeColor: '#f6f1e7' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard 공식 dynamic subset (OFL): 페이지에 나온 글자 범위의 조각만 내려받는다 */}
        <link rel="stylesheet" href="/fonts/pretendard/pretendardvariable-dynamic-subset.css" />
      </head>
      <body>
        {/* 손그림 느낌: 정적인 일러스트에만 filter="url(#hand-wobble)" (움직이는 요소엔 쓰지 않음) */}
        <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
          <filter id="hand-wobble">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
            <feDisplacementMap in="SourceGraphic" scale="2.6" />
          </filter>
        </svg>
        <a className="visually-hidden" href="#main">
          본문으로 건너뛰기
        </a>
        <SiteHeader />
        <div id="main">{children}</div>
        <footer className={styles.footer}>
          <p>
            버튼 하나 뒤에서 · 화면부터 서버까지 혼자 만든 인터랙티브 그림책 ·{' '}
            <a href={GITHUB_URL}>GitHub</a>
          </p>
          <p>글꼴 Pretendard (SIL Open Font License) · 그림은 모두 코드로 그린 SVG</p>
        </footer>
      </body>
    </html>
  );
}
