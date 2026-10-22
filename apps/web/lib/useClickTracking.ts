'use client';

import { useEffect } from 'react';
import { chapterOf, contactTarget, track } from './analytics';

/**
 * 문서 전체 클릭을 한 곳에서 듣고 GA 이벤트 두 가지만 보낸다.
 * 그래서 서버 컴포넌트(about 페이지 등)의 링크에도 onClick 없이 이벤트가 붙는다.
 * - 연락처 링크(이력서·GitHub·블로그…)는 주소로 알아본다 → contact_click
 * - 데모 버튼은 data-demo="이름" 속성이 붙은 버튼만 센다 → demo_run
 */
export function useClickTracking(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      const page = window.location.pathname;

      const demoButton = event.target.closest<HTMLElement>('[data-demo]');
      if (demoButton && !(demoButton as HTMLButtonElement).disabled) {
        track('demo_run', { demo: demoButton.dataset.demo ?? '', chapter: chapterOf(page) ?? 0 });
        return;
      }

      const link = event.target.closest('a');
      const target = link && contactTarget(link.getAttribute('href') ?? '');
      if (target) track('contact_click', { target, page });
    }
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, [enabled]);
}
