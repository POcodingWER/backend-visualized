import { INK, inkStroke } from '../components/atoms/ink';
import styles from './deploy.module.css';

const PAPER = '#fbf8f2';
const SKY = '#bcd4e0';
const SAGE = '#c5d8bf';
const APRICOT = '#f3c9a3';
const SOFT = '#5e564b';

function Box({
  x,
  y,
  w,
  h = 40,
  label,
  sub,
  fill = PAPER,
  dashed = false,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  label: string;
  sub?: string;
  fill?: string;
  dashed?: boolean;
}) {
  const cx = x + w / 2;
  return (
    <g opacity={dashed ? 0.75 : 1}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="6"
        fill={fill}
        {...inkStroke}
        strokeDasharray={dashed ? '5 4' : undefined}
      />
      <text
        x={cx}
        y={sub ? y + h / 2 - 3 : y + h / 2 + 5}
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill={INK}
      >
        {label}
      </text>
      {sub && (
        <text x={cx} y={y + h / 2 + 13} textAnchor="middle" fontSize="10.5" fill={SOFT}>
          {sub}
        </text>
      )}
    </g>
  );
}

/** 원통(DB·저장소) */
function Drum({
  x,
  y,
  w,
  label,
  sub,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  sub?: string;
}) {
  const rx = w / 2;
  return (
    <g>
      <path d={`M${x} ${y + 7} v28 a${rx} 7 0 0 0 ${w} 0 v-28`} fill={PAPER} {...inkStroke} />
      <ellipse cx={x + rx} cy={y + 7} rx={rx} ry="7" fill={PAPER} {...inkStroke} />
      <text x={x + rx} y={y + 30} textAnchor="middle" fontSize="12.5" fontWeight="700" fill={INK}>
        {label}
      </text>
      {sub && (
        <text x={x + rx} y={y + 56} textAnchor="middle" fontSize="10.5" fill={SOFT}>
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrow({ d, dashed = false }: { d: string; dashed?: boolean }) {
  return (
    <path
      d={d}
      fill="none"
      {...inkStroke}
      strokeWidth="1.6"
      strokeDasharray={dashed ? '5 4' : undefined}
      markerEnd="url(#overview-arrow)"
    />
  );
}

function Note({
  x,
  y,
  children,
  anchor = 'start',
}: {
  x: number;
  y: number;
  children: string;
  anchor?: 'start' | 'middle' | 'end';
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize="10.5" fill={SOFT}>
      {children}
    </text>
  );
}

/** 번호 동그라미: 아래 설명 목록의 ①②③과 짝 */
function Mark({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="9" fill={APRICOT} {...inkStroke} strokeWidth="1.5" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
        {n}
      </text>
    </g>
  );
}

/** 한 장으로 보는 전체 구조. 아래 자세한 그림들은 이 그림의 ①②③을 펼친 것 */
export function OverviewDiagram() {
  return (
    <figure className={styles.overview}>
      <svg
        viewBox="0 0 420 600"
        role="img"
        aria-label="전체 구조: 브라우저는 화면을 Vercel에서, API를 AWS 서버의 Caddy에서 받는다. Caddy는 지금 서비스 중인 색의 API 2개에 나눠 보내고, API는 MySQL과 Redis를 쓴다. GitHub Actions는 이미지를 GHCR에 올리고 SSM으로 deploy.sh를 실행해, 쉬던 색을 띄운 뒤 Caddy를 돌린다."
      >
        <defs>
          <marker
            id="overview-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M1 1 L9 5 L1 9"
              fill="none"
              stroke={INK}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </marker>
        </defs>

        {/* 밖: 브라우저 · Vercel · GitHub */}
        <Box x={10} y={10} w={120} label="브라우저" />
        <Arrow d="M70 50 V86" />
        <Note x={76} y={72}>
          화면
        </Note>
        <Box x={10} y={90} w={120} label="Vercel" sub="Next.js 화면" />

        <Box x={280} y={10} w={130} label="GitHub Actions" />
        <Arrow d="M320 50 V86" />
        <Note x={314} y={72} anchor="end">
          이미지
        </Note>
        <Drum x={270} y={90} w={100} label="GHCR" />
        <Arrow d="M398 50 V196" />
        <Mark x={262} y={30} n={2} />
        <Note x={392} y={150} anchor="end">
          SSM
        </Note>

        {/* EC2 */}
        <rect
          x={10}
          y={158}
          width={400}
          height={342}
          rx="10"
          fill="none"
          {...inkStroke}
          strokeDasharray="6 5"
        />
        <text x={22} y={178} fontSize="11.5" fontWeight="700" fill={INK}>
          AWS 서버 한 대 (EC2 t4g.small)
        </text>

        {/* 브라우저 → Caddy */}
        <Arrow d="M130 40 C 175 60, 175 150, 175 196" />
        <Note x={182} y={120}>
          API · HTTPS 443
        </Note>
        <Mark x={160} y={120} n={1} />

        <Box
          x={60}
          y={200}
          w={230}
          label="Caddy (문지기)"
          sub="덜 바쁜 쪽으로 나눠 보냄"
          fill={APRICOT}
          h={44}
        />
        <Box x={316} y={200} w={88} label="deploy.sh" h={44} />
        <Arrow d="M316 222 H294" dashed />

        {/* Caddy → blue */}
        <Arrow d="M280 244 C 300 260, 320 270, 330 286" dashed />

        <rect
          x={22}
          y={270}
          width={250}
          height={92}
          rx="8"
          fill="#e3edf2"
          {...inkStroke}
          strokeWidth="1.5"
        />
        <text x={98} y={286} fontSize="11" fontWeight="700" fill={INK}>
          blue · 서비스 중
        </text>
        <Arrow d="M89 244 V296" />
        <Arrow d="M207 244 V296" />
        <Box x={34} y={300} w={110} label="api_blue_1" fill={SKY} />
        <Box x={152} y={300} w={110} label="api_blue_2" fill={SKY} />

        <rect
          x={284}
          y={290}
          width={116}
          height={92}
          rx="8"
          fill="none"
          {...inkStroke}
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <text x={342} y={308} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
          green · 쉬는 중
        </text>
        <Box x={294} y={316} w={96} h={28} label="api_green ×2" fill={SAGE} dashed />
        <Note x={342} y={366} anchor="middle">
          다음 배포 때 켜짐
        </Note>
        <Mark x={320} y={258} n={3} />

        {/* blue → 데이터 */}
        <Arrow d="M89 340 V396" />
        <Arrow d="M207 340 V396" />
        <Drum x={50} y={400} w={90} label="MySQL" />
        <Drum x={170} y={400} w={80} label="Redis" />
        <Note x={266} y={424}>
          API · DB · Redis는
        </Note>
        <Note x={266} y={440}>
          서버 안쪽에서만 보여요
        </Note>

        {/* 백업 */}
        <Arrow d="M95 444 C 95 520, 95 520, 95 536" />
        <Note x={102} y={525}>
          매일 04:00 백업
        </Note>
        <Drum x={50} y={540} w={90} label="S3" />
      </svg>
    </figure>
  );
}
