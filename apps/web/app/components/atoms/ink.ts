/** 손그림 만화의 먹색. globals.css의 --ink와 같은 값 (SVG 속성엔 CSS 변수 대신 값이 필요할 때 쓴다) */
export const INK = '#2b2620';

/** 손그림 선 굵기·끝 모양. 채움은 <svg fill="none">에서 물려받는다 */
export const inkStroke = {
  stroke: INK,
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
