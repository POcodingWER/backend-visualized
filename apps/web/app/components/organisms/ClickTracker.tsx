'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { chapterOf, contactTarget, track } from '../../../lib/analytics';

/**
 * 화면에 그리는 건 없고, 문서 전체 클릭을 한 곳에서 듣는다.
 * 그래서 서버 컴포넌트(about 페이지 등)의 링크에도 onClick 없이 이벤트가 붙는다.
 * - 연락처 링크(이력서·GitHub·블로그…)는 주소로 알아본다
 * - 데모 버튼은 data-demo="이름" 속성이 붙은 버튼만 센다
 */
export default function ClickTracker() {
  const pathname = usePathname();

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      const page = window.location.pathname;

      const demoButton = event.target.closest<HTMLElement>('[data-demo]');
      if (demoButton && !(demoButton as HTMLButtonElement).disabled) {
        track('demo_run', {
          demo: demoButton.dataset.demo ?? '',
          chapter: chapterOf(page) ?? 0,
        });
        return;
      }

      const link = event.target.closest('a');
      const target = link && contactTarget(link.getAttribute('href') ?? '');
      if (target) track('contact_click', { target, page });
    }
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, [pathname]);

  return null;
}
