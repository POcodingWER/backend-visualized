import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'backend-visualized',
  description: '백엔드 작동 원리를 재현·측정·시각화하는 플레이그라운드',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        style={{
          fontFamily: "system-ui, -apple-system, 'Apple SD Gothic Neo', sans-serif",
          margin: 0,
          background: '#0b1020',
          color: '#e6e9f2',
        }}
      >
        {children}
      </body>
    </html>
  );
}
