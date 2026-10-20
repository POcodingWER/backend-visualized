export const GITHUB_URL = 'https://github.com/POcodingWER/backend-visualized';

export const CHAPTERS = [
  { number: 1, href: '/ticketing', title: '티켓팅', subtitle: '선착순에 몰린 500명' },
  { number: 2, href: '/wristband', title: '손목밴드', subtitle: '로그인이 유지되는 원리' },
  { number: 3, href: '/delivery', title: '묶음배송', subtitle: '클릭 기록이 저장되기까지' },
  { number: 4, href: '/ledger', title: '포인트 통장', subtitle: '잔액이 저절로 틀어지는 이유' },
  {
    number: 5,
    href: '/double-pay',
    title: '결제 버튼 두 번',
    subtitle: '두 번 눌러도 한 번만 결제',
  },
  { number: 6, href: '/cache', title: '맛집 메뉴판', subtitle: '빠르게 보여주고, 제때 바꾸기' },
] as const;
