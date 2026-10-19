import { ChapterLayout, ComicStrip } from '../components/ui';
import TicketingDemo from './TicketingDemo';

export const metadata = { title: '1장 티켓팅: 100석에 500명이 몰리면 — 버튼 하나 뒤에서' };

const INK = '#2b2620';
// 채움은 <svg fill="none">에서 물려받는다
const ink = {
  stroke: INK,
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** 휴대폰 든 사람 한 명 (x,y = 머리 중심) */
function PersonWithPhone({ x, y, screen }: { x: number; y: number; screen?: 'button' | 'ok' }) {
  return (
    <g>
      <circle cx={x} cy={y} r="9" fill="#fbf8f2" {...ink} />
      <path d={`M${x - 14} ${y + 40} Q${x} ${y + 6} ${x + 14} ${y + 40}`} {...ink} fill="#bcd4e0" />
      {screen && (
        <g>
          <rect
            x={x + 11}
            y={y + 8}
            width="14"
            height="21"
            rx="3"
            fill="#fbf8f2"
            {...ink}
            strokeWidth="1.6"
          />
          {screen === 'button' && (
            <rect
              x={x + 13}
              y={y + 20}
              width="10"
              height="5"
              rx="1.5"
              fill="#f2c7a2"
              stroke={INK}
              strokeWidth="1"
            />
          )}
          {screen === 'ok' && (
            <path
              d={`M${x + 14} ${y + 18} l3 3 l5 -6`}
              {...ink}
              strokeWidth="1.8"
              stroke="#44633d"
            />
          )}
        </g>
      )}
    </g>
  );
}

const PANELS = [
  {
    caption: '공연 표는 딱 100장. 9시 정각에 판매를 시작해요.',
    art: (
      <g>
        <rect x="40" y="40" width="160" height="110" rx="6" fill="#ede5d5" {...ink} />
        <path d="M30 42 L120 14 L210 42" {...ink} fill="#f2c7a2" />
        <rect x="70" y="70" width="100" height="56" rx="4" fill="#fbf8f2" {...ink} />
        <text x="120" y="96" textAnchor="middle" fontSize="18" fontWeight="700" fill={INK}>
          100석
        </text>
        <text x="120" y="116" textAnchor="middle" fontSize="13" fill="#5e564b">
          9:00 판매 시작
        </text>
        <path d="M40 150 H200" {...ink} />
      </g>
    ),
  },
  {
    caption: '9시가 되자 500명이 같은 순간에 "예매" 버튼을 눌러요.',
    art: (
      <g>
        {[20, 70, 120, 170].map((x, index) => (
          <PersonWithPhone key={x} x={x + 10} y={index % 2 ? 70 : 60} screen="button" />
        ))}
        {[45, 95, 145, 195].map((x) => (
          <PersonWithPhone key={x} x={x} y={118} />
        ))}
        <text x="120" y="28" textAnchor="middle" fontSize="15" fontWeight="700" fill={INK}>
          × 500명
        </text>
        <path d="M60 36 l-6 -6 M120 38 v-6 M180 36 l6 -6" {...ink} strokeWidth="1.5" />
      </g>
    ),
  },
  {
    caption:
      '서버는 한 명 한 명에게 "아직 자리 있어요"라고 답해요. 같은 순간이라 다 맞는 말처럼 보여요.',
    art: (
      <g>
        <rect x="88" y="60" width="64" height="80" rx="6" fill="#ede5d5" {...ink} />
        <path d="M100 80 H140 M100 96 H140 M100 112 H128" {...ink} strokeWidth="1.5" />
        <text x="120" y="156" textAnchor="middle" fontSize="13" fill="#5e564b">
          서버
        </text>
        {[
          [36, 40],
          [204, 40],
          [36, 120],
          [204, 120],
        ].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <path
              d={`M${x < 120 ? 88 : 152} ${y < 100 ? 80 : 120} L${x < 120 ? x + 30 : x - 30} ${y + 8}`}
              {...ink}
              strokeWidth="1.2"
              strokeDasharray="3 4"
            />
            <rect
              x={x - 32}
              y={y - 10}
              width="64"
              height="26"
              rx="12"
              fill="#b4c9a9"
              {...ink}
              strokeWidth="1.6"
            />
            <text x={x} y={y + 7} textAnchor="middle" fontSize="13" fontWeight="700" fill={INK}>
              자리 있음
            </text>
          </g>
        ))}
      </g>
    ),
  },
  {
    caption: '공연장에 500명이 도착했어요. 의자는 100개뿐인데요.',
    art: (
      <g>
        <path d="M20 30 Q120 16 220 30" {...ink} />
        {Array.from({ length: 30 }, (_, index) => {
          const x = 46 + (index % 10) * 16;
          const y = 52 + Math.floor(index / 10) * 22;
          return (
            <g key={index}>
              <rect
                x={x - 6}
                y={y + 4}
                width="12"
                height="9"
                rx="2"
                fill="#b4c9a9"
                stroke={INK}
                strokeWidth="1.2"
              />
              <circle cx={x} cy={y + 2} r="3.5" fill={INK} />
            </g>
          );
        })}
        {Array.from({ length: 34 }, (_, index) => (
          <circle
            key={index}
            cx={22 + (index % 17) * 12 + (Math.floor(index / 17) % 2) * 5}
            cy={132 + Math.floor(index / 17) * 14}
            r="4.2"
            fill="#a3321f"
          />
        ))}
        <text x="120" y="174" textAnchor="middle" fontSize="13" fill="#a3321f">
          서 있는 400명
        </text>
      </g>
    ),
  },
];

export default function TicketingPage() {
  return (
    <ChapterLayout
      chapterNumber={1}
      title="티켓팅"
      question="표는 100장인데 500명이 동시에 누르면, 서버는 몇 장을 팔까요?"
    >
      <section style={{ maxWidth: 'var(--wide)', margin: '0 auto var(--space-16)' }}>
        <ComicStrip
          label="4컷 만화: 100석짜리 공연에 500명이 동시에 예매하는 이야기"
          panels={PANELS}
        />
      </section>
      <TicketingDemo />
    </ChapterLayout>
  );
}
