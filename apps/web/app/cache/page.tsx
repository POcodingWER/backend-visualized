import { ChapterLayout } from '../components/organisms/ChapterLayout';
import { ComicStrip } from '../components/organisms/ComicStrip';
import CacheDemo from './CacheDemo';
import { INK, inkStroke } from '../components/atoms/ink';

export const metadata = {
  title: '6장 맛집 대기표: 빠르게 보여주고, 제때 바꾸기 — 버튼 하나 뒤에서',
};

function Kitchen({ x, y, busy = false }: { x: number; y: number; busy?: boolean }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="70"
        height="56"
        rx="4"
        fill={busy ? '#f2d3c8' : '#ede5d5'}
        {...inkStroke}
      />
      <path
        d={`M${x - 6} ${y + 2} L${x + 35} ${y - 22} L${x + 76} ${y + 2}`}
        fill="#b4c9a9"
        {...inkStroke}
      />
      <text x={x + 35} y={y + 34} textAnchor="middle" fontSize="12" fontWeight="700" fill={INK}>
        주방
      </text>
    </g>
  );
}

function Guest({ x, y, fill = '#bcd4e0' }: { x: number; y: number; fill?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="7" fill="#fbf8f2" {...inkStroke} strokeWidth="1.6" />
      <path
        d={`M${x - 10} ${y + 26} Q${x} ${y + 4} ${x + 10} ${y + 26}`}
        fill={fill}
        {...inkStroke}
        strokeWidth="1.6"
      />
    </g>
  );
}

function Board({
  x,
  y,
  text,
  stale = false,
}: {
  x: number;
  y: number;
  text: string;
  stale?: boolean;
}) {
  return (
    <g>
      <rect x={x} y={y} width="86" height="50" rx="4" fill="#fbf8f2" {...inkStroke} />
      <text x={x + 8} y={y + 18} fontSize="10" fill="#5e564b">
        오늘의 메뉴
      </text>
      <text x={x + 8} y={y + 38} fontSize="13" fontWeight="800" fill={stale ? '#a3321f' : INK}>
        {text}
      </text>
    </g>
  );
}

const PANELS = [
  {
    caption: '손님마다 주방에 "오늘 메뉴 뭐예요?" 하고 물어보면, 주방이 대답하느라 요리를 못 해요.',
    art: (
      <g>
        <Kitchen x={150} y={70} busy />
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Guest key={index} x={22 + (index % 3) * 34} y={44 + Math.floor(index / 3) * 62} />
        ))}
        <path d="M120 60 L146 80 M120 120 L146 104" {...inkStroke} strokeDasharray="3 4" />
      </g>
    ),
  },
  {
    caption:
      '그래서 문 앞에 대기판을 걸어요. 손님은 대기판만 보고, 대기판은 5초마다 새로 확인해요.',
    art: (
      <g>
        <Kitchen x={160} y={90} />
        <Board x={70} y={20} text="김치찌개" />
        {[0, 1, 2].map((index) => (
          <Guest key={index} x={30 + index * 30} y={120} />
        ))}
      </g>
    ),
  },
  {
    caption: '메뉴가 바뀌어도, 대기판을 다시 확인하기 전까지는 옛 메뉴가 보여요.',
    art: (
      <g>
        <Board x={14} y={40} text="김치찌개" stale />
        <Kitchen x={150} y={70} />
        <text x="185" y="150" textAnchor="middle" fontSize="12" fontWeight="700" fill={INK}>
          된장찌개
        </text>
        <path d="M110 64 H140" {...inkStroke} />
        <text x="125" y="58" textAnchor="middle" fontSize="16" fill="#a3321f">
          ≠
        </text>
      </g>
    ),
  },
  {
    caption: '대기판이 비는 순간 다 같이 주방으로 몰리지 않게, 열쇠를 쥔 한 명만 확인하러 가요.',
    art: (
      <g>
        <Kitchen x={160} y={70} />
        <Guest x={130} y={96} fill="#f2c7a2" />
        <circle cx="146" cy="88" r="5" fill="#f2c7a2" {...inkStroke} strokeWidth="1.6" />
        <path d="M149 91 l8 8 m-3 -3 l3 -3" {...inkStroke} strokeWidth="1.6" />
        {[0, 1, 2, 3, 4].map((index) => (
          <Guest key={index} x={20 + (index % 3) * 30} y={60 + Math.floor(index / 3) * 56} />
        ))}
      </g>
    ),
  },
];

export default function CachePage() {
  return (
    <ChapterLayout
      chapterNumber={6}
      title="맛집 대기표"
      question="손님 1000명이 같은 걸 물어볼 때마다 데이터베이스에 다녀와야 할까요? 미리 적어 둔 답을 보여주면 무엇이 빨라지고, 무엇이 늦어질까요?"
    >
      <section style={{ maxWidth: 'var(--wide)', margin: '0 auto var(--space-16)' }}>
        <ComicStrip label="4컷 만화: 맛집 대기판으로 보는 캐시 이야기" panels={PANELS} />
      </section>
      <CacheDemo />
    </ChapterLayout>
  );
}
