import { CHAPTERS } from './site';

/**
 * GA 이벤트는 딱 두 종류만 센다. 늘리면 GA 화면이 지저분해져서 정작 볼 숫자가 묻힌다.
 * - contact_click: 이력서·GitHub·블로그 같은 "나를 더 알아보는" 링크 클릭 (어느 페이지에서 눌렀는지 포함)
 * - demo_run: 각 장의 큰 "직접 해 보기" 버튼 (data-ga-demo 속성이 붙은 버튼)
 */
export type ContactTarget = 'resume_pdf' | 'resume_web' | 'blog' | 'github' | 'email' | 'instagram';

/** 링크 주소로 어떤 연락처인지 고른다. 연락처가 아니면 null (일반 링크·장 이동은 세지 않는다) */
export function contactTarget(href: string): ContactTarget | null {
  if (href.startsWith('mailto:')) return 'email';
  let url: URL;
  try {
    url = new URL(href, 'https://bv.chuckplay.dev');
  } catch {
    return null;
  }
  if (url.pathname.endsWith('/resume.pdf')) return 'resume_pdf';
  if (url.hostname === 'pocodingwer.github.io') {
    return url.pathname.startsWith('/about') ? 'resume_web' : 'blog';
  }
  if (url.hostname === 'github.com' && url.pathname.toLowerCase().startsWith('/pocodingwer'))
    return 'github';
  if (url.hostname.endsWith('instagram.com')) return 'instagram';
  return null;
}

/** /ticketing → 1. 장이 아닌 페이지면 null */
export function chapterOf(pathname: string): number | null {
  return CHAPTERS.find((chapter) => pathname.startsWith(chapter.href))?.number ?? null;
}

type Gtag = (command: 'event', name: string, params: Record<string, string | number>) => void;

/** GA가 안 실린 곳(로컬·프리뷰)에선 아무것도 안 한다 */
export function track(name: 'contact_click' | 'demo_run', params: Record<string, string | number>) {
  const gtag = (window as unknown as { gtag?: Gtag }).gtag;
  gtag?.('event', name, params);
}
