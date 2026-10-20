import { ChapterLayout } from '../components/organisms/ChapterLayout';
import { ComicStrip } from '../components/organisms/ComicStrip';
import AuthDemo from './AuthDemo';
import { INK, inkStroke } from '../components/atoms/ink';

export const metadata = { title: '2장 손목밴드: 로그인이 유지되는 원리 — 버튼 하나 뒤에서' };

/** 손목밴드 찬 손님 (x = 중심) */
function Guest({ x, y = 70, band = '#f2c7a2' }: { x: number; y?: number; band?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="11" fill="#fbf8f2" {...inkStroke} />
      <path
        d={`M${x - 18} ${y + 60} Q${x} ${y + 12} ${x + 18} ${y + 60}`}
        fill="#bcd4e0"
        {...inkStroke}
      />
      <path d={`M${x + 12} ${y + 30} l14 -8`} {...inkStroke} />
      <rect
        x={x + 20}
        y={y + 17}
        width="10"
        height="6"
        rx="2"
        fill={band}
        {...inkStroke}
        strokeWidth="1.4"
      />
    </g>
  );
}

function Receipt({ x, y, rotate = 0 }: { x: number; y: number; rotate?: number }) {
  return (
    <g transform={`rotate(${rotate} ${x + 15} ${y + 20})`}>
      <path
        d={`M${x} ${y} h30 v40 l-5 -4 l-5 4 l-5 -4 l-5 4 l-5 -4 l-5 4 z`}
        fill="#fbf8f2"
        {...inkStroke}
        strokeWidth="1.6"
      />
      <path
        d={`M${x + 6} ${y + 10} h18 M${x + 6} ${y + 18} h12`}
        {...inkStroke}
        strokeWidth="1.2"
      />
    </g>
  );
}

const PANELS = [
  {
    caption: '입구에서 표를 보여주면 손목밴드와 재발급 영수증을 줘요.',
    art: (
      <g>
        <rect x="120" y="40" width="96" height="100" rx="6" fill="#ede5d5" {...inkStroke} />
        <text x="168" y="70" textAnchor="middle" fontSize="15" fontWeight="700" fill={INK}>
          입구
        </text>
        <rect
          x="140"
          y="88"
          width="20"
          height="10"
          rx="3"
          fill="#f2c7a2"
          {...inkStroke}
          strokeWidth="1.4"
        />
        <Receipt x={170} y={82} />
        <Guest x={60} />
      </g>
    ),
  },
  {
    caption: '놀이기구마다 손목밴드만 보여줘요. 밴드는 금방 색이 바래요.',
    art: (
      <g>
        <path d="M120 140 V60 Q170 10 220 60 V140" fill="#b4c9a9" {...inkStroke} />
        <path d="M140 140 V80 M200 140 V80 M150 70 h40" {...inkStroke} strokeWidth="1.6" />
        <Guest x={60} band="#f2c7a2" />
        <text x="60" y="166" textAnchor="middle" fontSize="13" fill="#5e564b">
          15초짜리 밴드
        </text>
      </g>
    ),
  },
  {
    caption: '밴드가 바래면 창구에 영수증을 내고 새 밴드와 새 영수증을 받아요.',
    art: (
      <g>
        <rect x="130" y="40" width="90" height="100" rx="6" fill="#ede5d5" {...inkStroke} />
        <text x="175" y="70" textAnchor="middle" fontSize="15" fontWeight="700" fill={INK}>
          재발급
        </text>
        <Receipt x={160} y={84} />
        <Guest x={56} band="#ede5d5" />
        <path
          d="M92 96 C110 86 122 86 140 96"
          {...inkStroke}
          strokeWidth="1.6"
          strokeDasharray="3 4"
        />
      </g>
    ),
  },
  {
    caption: '누가 영수증을 복사해 오면? 같은 영수증이 두 번 오는 순간 창구가 알아채요.',
    art: (
      <g>
        <Receipt x={70} y={50} rotate={-8} />
        <Receipt x={130} y={50} rotate={8} />
        <text x="120" y="44" textAnchor="middle" fontSize="20" fontWeight="800" fill="#a3321f">
          =
        </text>
        <path d="M60 130 l120 0" stroke="#a3321f" strokeWidth="3" strokeLinecap="round" />
        <text x="120" y="158" textAnchor="middle" fontSize="14" fontWeight="700" fill="#a3321f">
          둘 다 무효
        </text>
      </g>
    ),
  },
];

export default function WristbandPage() {
  return (
    <ChapterLayout
      chapterNumber={2}
      title="손목밴드"
      question="새로고침해도 로그인이 풀리지 않는 건 어떻게 될까요? 그리고 누가 그 비밀을 복사해 가면요?"
    >
      <section style={{ maxWidth: 'var(--wide)', margin: '0 auto var(--space-16)' }}>
        <ComicStrip label="4컷 만화: 놀이공원 손목밴드와 재발급 영수증 이야기" panels={PANELS} />
      </section>
      <AuthDemo />
    </ChapterLayout>
  );
}
