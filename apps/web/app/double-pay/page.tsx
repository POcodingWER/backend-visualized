import type { ReactNode } from 'react';
import { ChapterLayout } from '../components/organisms/ChapterLayout';
import { ComicStrip } from '../components/organisms/ComicStrip';
import PaymentDemo from './PaymentDemo';
import { INK, inkStroke } from '../components/atoms/ink';

export const metadata = {
  title: '5장 결제 버튼 두 번: 두 번 눌러도 한 번만 결제 — 버튼 하나 뒤에서',
};

function Phone({ x, y, children }: { x: number; y: number; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width="84" height="150" rx="12" fill="#fbf8f2" {...inkStroke} />
      <path d={`M${x + 32} ${y + 10} H${x + 52}`} {...inkStroke} />
      {children}
    </g>
  );
}

function PayButton({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width="64" height="26" rx="7" fill="#f2c7a2" {...inkStroke} />
      <text x={x + 32} y={y + 17} textAnchor="middle" fontSize="12" fontWeight="700" fill={INK}>
        결제
      </text>
    </g>
  );
}

function Message({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="70"
        height="24"
        rx="6"
        fill="#f2d3c8"
        {...inkStroke}
        strokeWidth="1.5"
      />
      <text x={x + 35} y={y + 16} textAnchor="middle" fontSize="10" fill="#a3321f" fontWeight="700">
        12,000원 결제
      </text>
    </g>
  );
}

const PANELS = [
  {
    caption: '결제 버튼을 눌렀는데, 화면이 멈춘 것 같아요.',
    art: (
      <g>
        <Phone x={78} y={14}>
          <PayButton x={88} y={120} />
          <circle cx="120" cy="70" r="16" {...inkStroke} strokeDasharray="20 10" />
        </Phone>
      </g>
    ),
  },
  {
    caption: '답답해서 또 누르고, 앱은 응답이 늦자 알아서 한 번 더 보내요.',
    art: (
      <g>
        <Phone x={30} y={14}>
          <PayButton x={40} y={120} />
        </Phone>
        <path d="M120 116 l14 -8 M122 132 h18 M120 148 l14 8" {...inkStroke} />
        <path d="M150 60 C200 40 214 100 168 112" {...inkStroke} />
        <path d="M168 112 l10 -10 M168 112 l12 4" {...inkStroke} />
        <text x="186" y="48" fontSize="12" fontWeight="700" fill={INK}>
          재시도
        </text>
      </g>
    ),
  },
  {
    caption: '서버가 요청마다 돈을 빼면, 결제 문자가 여러 번 와요.',
    art: (
      <g>
        <Phone x={78} y={14}>
          <Message x={85} y={40} />
          <Message x={85} y={72} />
          <Message x={85} y={104} />
        </Phone>
      </g>
    ),
  },
  {
    caption:
      '요청마다 같은 번호표(멱등성 키)를 붙이면, 처음 것만 결제하고 나머지엔 같은 영수증을 보여줘요.',
    art: (
      <g>
        <rect x="64" y="20" width="112" height="140" rx="4" fill="#fbf8f2" {...inkStroke} />
        <text x="120" y="48" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK}>
          영수증
        </text>
        <path d="M80 64 H160 M80 84 H150 M80 104 H156" stroke="#b9ac95" strokeWidth="1.5" />
        <circle cx="140" cy="132" r="18" fill="#b4c9a9" {...inkStroke} />
        <text x="140" y="137" textAnchor="middle" fontSize="12" fontWeight="800" fill={INK}>
          1번
        </text>
        <rect
          x="14"
          y="70"
          width="44"
          height="22"
          rx="5"
          fill="#bcd4e0"
          {...inkStroke}
          strokeWidth="1.5"
        />
        <text x="36" y="85" textAnchor="middle" fontSize="10" fill={INK}>
          #A7
        </text>
      </g>
    ),
  },
];

export default function DoublePayPage() {
  return (
    <ChapterLayout
      chapterNumber={5}
      title="결제 버튼 두 번"
      question="결제 버튼을 연달아 누르거나 앱이 알아서 다시 보내면, 돈이 몇 번 빠져나갈까요?"
    >
      <section style={{ maxWidth: 'var(--wide)', margin: '0 auto var(--space-16)' }}>
        <ComicStrip
          label="4컷 만화: 결제 버튼을 여러 번 눌러도 한 번만 결제되게 하는 이야기"
          panels={PANELS}
        />
      </section>
      <PaymentDemo />
    </ChapterLayout>
  );
}
