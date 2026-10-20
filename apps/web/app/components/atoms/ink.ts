/** 손그림 만화의 먹색. globals.css의 --ink와 같은 값 (SVG 속성엔 CSS 변수 대신 값이 필요할 때 쓴다) */
export const INK = '#2b2620';

/**
 * 손그림 선 굵기·끝 모양. 채움은 <svg fill="none">에서 물려받는다.
 * 손그림 느낌은 둥근 끝·이음과 손으로 그린 듯한 경로로만 낸다. SVG 필터(feDisplacementMap 등)로 선을 흔들지 말 것:
 * 필터는 화면 픽셀 단위로 래스터화돼서 레티나·Safari에서 선이 계단처럼 찢어진다.
 */
export const inkStroke = {
  stroke: INK,
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
