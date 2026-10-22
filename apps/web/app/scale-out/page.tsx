import { ChapterLayout } from '../components/organisms/ChapterLayout';
import { ComicStrip } from '../components/organisms/ComicStrip';
import ScaleOutDemo from './ScaleOutDemo';
import { INK, inkStroke } from '../components/atoms/ink';
import ui from '../components/ui.module.css';

export const metadata = {
  title: '7장 계산대 하나 더: 서버 두 대로 나눠 받기 — 버튼 하나 뒤에서',
};

/** 계산대. lit=false면 불 꺼진(쉬는) 계산대 */
function Counter({
  x,
  y,
  lit = true,
  busy = false,
}: {
  x: number;
  y: number;
  lit?: boolean;
  busy?: boolean;
}) {
  const fill = !lit ? '#d9d2c3' : busy ? '#f2d3c8' : '#ede5d5';
  return (
    <g>
      <rect x={x} y={y} width="62" height="40" rx="4" fill={fill} {...inkStroke} />
      <rect x={x + 18} y={y - 14} width="26" height="14" rx="2" fill="#fbf8f2" {...inkStroke} />
      <text x={x + 31} y={y + 25} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
        {lit ? '계산대' : '꺼짐'}
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

function Notebook({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width="56" height="38" rx="3" fill="#fbf8f2" {...inkStroke} />
      <text x={x + 28} y={y + 16} textAnchor="middle" fontSize="10" fill="#5e564b">
        마감
      </text>
      <text x={x + 28} y={y + 30} textAnchor="middle" fontSize="10" fontWeight="700" fill={INK}>
        정산
      </text>
    </g>
  );
}

const PANELS = [
  {
    caption: '계산대가 하나뿐이면 손님이 아무리 몰려도 한 명씩만 계산해요. 줄만 길어져요.',
    art: (
      <g>
        <Counter x={160} y={80} busy />
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Guest key={index} x={24 + (index % 3) * 36} y={48 + Math.floor(index / 3) * 62} />
        ))}
        <path d="M128 100 H152" {...inkStroke} strokeDasharray="3 4" />
      </g>
    ),
  },
  {
    caption:
      '알고 보니 옆에 계산대가 하나 더 있는데 불이 꺼져 있었어요. 서버 칸(CPU 코어)은 둘인데 하나만 쓰고 있던 거예요.',
    art: (
      <g>
        <Counter x={30} y={80} busy />
        <Counter x={148} y={80} lit={false} />
        {/* 바쁜 쪽 땀방울 */}
        <path
          d="M44 54 q-5 8 0 10 q5 -2 0 -10 Z M80 48 q-5 8 0 10 q5 -2 0 -10 Z"
          fill="#bcd4e0"
          {...inkStroke}
          strokeWidth="1.4"
        />
        <text x="179" y="146" textAnchor="middle" fontSize="11" fill="#5e564b">
          아무도 없음
        </text>
      </g>
    ),
  },
  {
    caption: '계산대를 하나 더 열고, 입구 직원이 줄이 짧은 쪽으로 손님을 보내요.',
    art: (
      <g>
        <Counter x={22} y={30} />
        <Counter x={156} y={30} />
        <Guest x={120} y={120} fill="#f2c7a2" />
        <path d="M108 118 L72 84 M132 118 L168 84" {...inkStroke} />
        <path d="M72 84 l2 9 M72 84 l9 2 M168 84 l-2 9 M168 84 l-9 2" {...inkStroke} />
        <text x="120" y="168" textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
          입구 직원
        </text>
      </g>
    ),
  },
  {
    caption:
      '그런데 마감 정산은 한 번이면 돼요. 두 계산대가 둘 다 하지 않게, 열쇠를 먼저 잡은 쪽만 해요.',
    art: (
      <g>
        <Counter x={14} y={40} />
        <Counter x={164} y={40} />
        <Notebook x={92} y={110} />
        <path d="M60 84 Q80 110 92 124" {...inkStroke} />
        <path d="M180 84 Q160 110 148 124" {...inkStroke} strokeDasharray="3 4" />
        <circle cx="70" cy="104" r="5" fill="#f2c7a2" {...inkStroke} strokeWidth="1.6" />
        <path d="M73 107 l8 8 m-3 -3 l3 -3" {...inkStroke} strokeWidth="1.6" />
        <text x="168" y="112" fontSize="11" fill="#5e564b">
          패스
        </text>
      </g>
    ),
  },
];

export default function ScaleOutPage() {
  return (
    <ChapterLayout
      chapterNumber={7}
      title="계산대 하나 더"
      question="손님이 몰려 서버 한 대가 숨이 찰 때, 같은 서버를 하나 더 켜면 무엇이 빨라지고 무엇이 꼬일까요?"
    >
      <section className={ui.wide}>
        <ComicStrip label="4컷 만화: 계산대를 하나 더 여는 스케일아웃 이야기" panels={PANELS} />
      </section>
      <ScaleOutDemo />
    </ChapterLayout>
  );
}
