import { ChapterLayout } from '../components/organisms/ChapterLayout';
import { ComicStrip } from '../components/organisms/ComicStrip';
import DeliveryDemo from './DeliveryDemo';
import { INK, inkStroke } from '../components/atoms/ink';

export const metadata = { title: '3장 묶음배송: 클릭 기록이 저장되기까지 — 버튼 하나 뒤에서' };

function Box({ x, y, size = 16 }: { x: number; y: number; size?: number }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={size}
        height={size}
        rx="2"
        fill="#f2c7a2"
        {...inkStroke}
        strokeWidth="1.5"
      />
      <path d={`M${x} ${y + size / 3} h${size}`} {...inkStroke} strokeWidth="1.2" />
    </g>
  );
}

function Truck({
  x,
  y,
  scale = 1,
  fill = '#fbf8f2',
}: {
  x: number;
  y: number;
  scale?: number;
  fill?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="0" y="0" width="40" height="22" rx="3" fill={fill} {...inkStroke} />
      <path d="M40 8 h12 l8 8 v6 h-20 z" fill={fill} {...inkStroke} />
      <circle cx="12" cy="25" r="4.5" fill="#fbf8f2" {...inkStroke} />
      <circle cx="48" cy="25" r="4.5" fill="#fbf8f2" {...inkStroke} />
    </g>
  );
}

const PANELS = [
  {
    caption: '사이트에서 누르는 클릭 하나하나가 서버로 보낼 택배 상자예요.',
    art: (
      <g>
        <rect x="40" y="30" width="160" height="110" rx="10" fill="#fbf8f2" {...inkStroke} />
        <path d="M40 52 H200" {...inkStroke} />
        <rect x="80" y="80" width="80" height="28" rx="8" fill="#bcd4e0" {...inkStroke} />
        <path d="M150 112 l10 22 l5 -9 l9 6" fill="#fbf8f2" {...inkStroke} />
        <Box x={176} y={70} />
        <Box x={190} y={96} />
      </g>
    ),
  },
  {
    caption: '상자마다 트럭을 한 대씩 부르면, 도로가 트럭으로 꽉 막혀요.',
    art: (
      <g>
        <path d="M10 150 H230" {...inkStroke} />
        {[0, 1, 2, 3].map((row) =>
          [0, 1, 2].map((column) => (
            <Truck
              key={`${row}-${column}`}
              x={12 + column * 76 + (row % 2) * 20}
              y={22 + row * 32}
              scale={0.85}
            />
          )),
        )}
      </g>
    ),
  },
  {
    caption: '물류센터에 모았다가, 100개가 차면 트럭 한 대에 다 실어 보내요.',
    art: (
      <g>
        <rect x="20" y="50" width="80" height="80" rx="4" fill="#ede5d5" {...inkStroke} />
        <path d="M14 54 L60 24 L106 54" fill="#b4c9a9" {...inkStroke} />
        {[0, 1, 2, 3].map((index) => (
          <Box
            key={index}
            x={30 + (index % 2) * 30}
            y={74 + Math.floor(index / 2) * 26}
            size={18}
          />
        ))}
        <Truck x={124} y={90} scale={1.6} fill="#b4c9a9" />
      </g>
    ),
  },
  {
    caption: '매일 저녁엔 오늘 들어온 상자를 종류별로 세어 장부에 적어 둬요.',
    art: (
      <g>
        <rect x="56" y="24" width="128" height="134" rx="4" fill="#fbf8f2" {...inkStroke} />
        <path
          d="M76 52 H164 M76 76 H164 M76 100 H164 M76 124 H140"
          {...inkStroke}
          strokeWidth="1.4"
          stroke="#b9ac95"
        />
        <text x="80" y="47" fontSize="13" fill={INK}>
          클릭 128
        </text>
        <text x="80" y="71" fontSize="13" fill={INK}>
          방문 42
        </text>
        <path d="M150 140 l30 -60 l8 4 l-30 60 z" fill="#f2c7a2" {...inkStroke} />
      </g>
    ),
  },
];

export default function DeliveryPage() {
  return (
    <ChapterLayout
      chapterNumber={3}
      title="묶음배송"
      question="클릭 하나마다 서버에 바로 보내면 어떻게 될까요? 모았다가 한 번에 보내면 얼마나 달라질까요?"
    >
      <section style={{ maxWidth: 'var(--wide)', margin: '0 auto var(--space-16)' }}>
        <ComicStrip label="4컷 만화: 클릭 기록을 택배처럼 묶어 보내는 이야기" panels={PANELS} />
      </section>
      <DeliveryDemo />
    </ChapterLayout>
  );
}
