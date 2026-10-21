import { createElement, Fragment, type ReactNode } from 'react';

/**
 * 글 데이터(steps.ts, content.ts)의 `백틱` 부분을 <code>로 바꾼다.
 * 문자열로 두면 검색·테스트가 쉽고, 화면에서는 코드 칩(ui.module.css .codeChips)으로 보인다.
 * (.ts라 JSX 대신 createElement: node 테스트에서도 그대로 불러올 수 있게)
 */
export function withCode(text: string): ReactNode {
  if (!text.includes('`')) return text;
  return text
    .split('`')
    .map((part, index) => createElement(index % 2 === 1 ? 'code' : Fragment, { key: index }, part));
}
