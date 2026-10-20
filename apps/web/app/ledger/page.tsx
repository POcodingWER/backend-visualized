import { ChapterLayout } from '../components/organisms/ChapterLayout';
import { ComicStrip } from '../components/organisms/ComicStrip';
import LedgerDemo from './LedgerDemo';
import { INK, inkStroke } from '../components/atoms/ink';

export const metadata = {
  title: '4장 포인트 통장: 잔액이 저절로 틀어지는 이유 — 버튼 하나 뒤에서',
};

function Passbook({ x, y, balance }: { x: number; y: number; balance: string }) {
  return (
    <g>
      <rect x={x} y={y} width="96" height="66" rx="5" fill="#bcd4e0" {...inkStroke} />
      <path d={`M${x} ${y + 18} H${x + 96}`} {...inkStroke} strokeWidth="1.4" />
      <text x={x + 10} y={y + 13} fontSize="10" fill={INK}>
        포인트 통장
      </text>
      <text x={x + 48} y={y + 48} textAnchor="middle" fontSize="17" fontWeight="800" fill={INK}>
        {balance}
      </text>
    </g>
  );
}

function Person({ x, y, fill }: { x: number; y: number; fill: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="11" fill="#fbf8f2" {...inkStroke} />
      <path
        d={`M${x - 16} ${y + 42} Q${x} ${y + 6} ${x + 16} ${y + 42}`}
        fill={fill}
        {...inkStroke}
      />
    </g>
  );
}

function Bubble({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="78"
        height="24"
        rx="10"
        fill="#fbf8f2"
        {...inkStroke}
        strokeWidth="1.5"
      />
      <text x={x + 39} y={y + 16} textAnchor="middle" fontSize="11" fill={INK}>
        {text}
      </text>
    </g>
  );
}

const PANELS = [
  {
    caption: '포인트 통장에는 잔액 숫자 하나만 적혀 있어요.',
    art: (
      <g>
        <Passbook x={72} y={50} balance="5,000P" />
        <circle cx="190" cy="56" r="14" fill="#f2c7a2" {...inkStroke} />
        <text x="190" y="61" textAnchor="middle" fontSize="13" fontWeight="800" fill={INK}>
          P
        </text>
      </g>
    ),
  },
  {
    caption: '두 사람이 동시에 잔액을 읽고, 각자 100P를 더해 적으려 해요.',
    art: (
      <g>
        <Passbook x={72} y={20} balance="5,000P" />
        <Person x={46} y={118} fill="#b4c9a9" />
        <Person x={194} y={118} fill="#f2c7a2" />
        <Bubble x={8} y={90} text="5,000+100" />
        <Bubble x={154} y={90} text="5,000+100" />
      </g>
    ),
  },
  {
    caption: '둘 다 "5,100"으로 덮어써서, 한 사람 몫 100P가 사라졌어요.',
    art: (
      <g>
        <Passbook x={72} y={30} balance="5,100P" />
        <circle cx="120" cy="140" r="16" fill="#f2d3c8" {...inkStroke} strokeDasharray="4 4" />
        <text x="120" y="145" textAnchor="middle" fontSize="11" fontWeight="700" fill="#a3321f">
          100P
        </text>
        <path d="M100 120 L140 160 M140 120 L100 160" stroke="#a3321f" strokeWidth="2.5" />
      </g>
    ),
  },
  {
    caption: '입출금 내역을 한 줄씩 남기면, 합계로 잔액을 언제든 다시 맞춰 볼 수 있어요.',
    art: (
      <g>
        <rect x="60" y="16" width="120" height="150" rx="4" fill="#fbf8f2" {...inkStroke} />
        {['+5,000 시작', '+100 적립', '+100 적립', '−100 사용'].map((line, index) => (
          <text key={index} x="74" y={42 + index * 24} fontSize="12" fill={INK}>
            {line}
          </text>
        ))}
        <path d="M70 128 H170" {...inkStroke} />
        <text x="74" y="150" fontSize="13" fontWeight="800" fill="#44633d">
          합계 5,100P ✓
        </text>
      </g>
    ),
  },
];

export default function LedgerPage() {
  return (
    <ChapterLayout
      chapterNumber={4}
      title="포인트 통장"
      question="적립과 사용이 동시에 몰리면 포인트 잔액은 맞을까요? 잔액 숫자만 고치는 것과 입출금 내역을 남기는 것, 무엇이 다를까요?"
    >
      <section style={{ maxWidth: 'var(--wide)', margin: '0 auto var(--space-16)' }}>
        <ComicStrip
          label="4컷 만화: 잔액 숫자만 덮어쓰다 포인트가 사라지는 이야기"
          panels={PANELS}
        />
      </section>
      <LedgerDemo />
    </ChapterLayout>
  );
}
