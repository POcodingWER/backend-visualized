import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GITHUB_URL } from '../lib/site';
import './globals.css';
import SiteHeader from './components/organisms/SiteHeader';
import styles from './components/ui.module.css';

const SITE_TITLE = '버튼 하나 뒤에서 — 매일 쓰는 기능 뒤의 서버 이야기';
const SITE_DESCRIPTION =
  '티켓팅, 로그인 유지, 클릭 기록, 포인트, 결제, 캐시. 서버가 실수하는 순간을 실제 서버와 데이터베이스에서 일부러 일으켜 보고, 고친 뒤 얼마나 나아졌는지 숫자로 확인하는 그림책 여섯 편.';

/**
 * 파비콘은 app/icon.svg, 공유 미리보기 그림은 app/opengraph-image.png (Next 파일 규칙으로 자동 연결).
 * metadataBase를 안 쓰면 Vercel에선 배포 주소로, 로컬에선 localhost로 절대 주소가 만들어진다.
 */
export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: '버튼 하나 뒤에서',
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: SITE_TITLE, description: SITE_DESCRIPTION },
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
