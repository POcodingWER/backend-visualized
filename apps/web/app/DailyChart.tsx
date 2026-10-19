'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface Daily {
  names: string[];
  series: { date: string; total: number; byName: Record<string, number> }[];
}

const COLORS = ['#818cf8', '#34d399', '#fb923c', '#22d3ee', '#f472b6', '#facc15'];

/** 집계 단계의 산출물: EventDailyStat 테이블(최근 7일, UTC) */
export default function DailyChart({ daily }: { daily: Daily }) {
  const data = daily.series.map((point) => ({ date: point.date.slice(5), ...point.byName }));
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#26304d" />
          <XAxis dataKey="date" stroke="#8b93b0" fontSize={12} />
          <YAxis allowDecimals={false} stroke="#8b93b0" fontSize={12} />
          <Tooltip contentStyle={{ background: '#121a33', border: '1px solid #2a3558' }} />
          <Legend />
          {daily.names.map((name, i) => (
            <Bar key={name} dataKey={name} stackId="a" fill={COLORS[i % COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
