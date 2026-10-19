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

const COLORS = ['#345E72', '#44633D', '#8E4F1F', '#345E72', '#A3321F', '#8E4F1F'];

/** 집계 단계의 산출물: EventDailyStat 테이블(최근 7일, UTC) */
export default function DailyChart({ daily }: { daily: Daily }) {
  const data = daily.series.map((point) => ({ date: point.date.slice(5), ...point.byName }));
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#D8CDBA" />
          <XAxis dataKey="date" stroke="#5E564B" fontSize={12} />
          <YAxis allowDecimals={false} stroke="#5E564B" fontSize={12} />
          <Tooltip contentStyle={{ background: '#FBF8F2', border: '1px solid #D8CDBA' }} />
          <Legend />
          {daily.names.map((name, i) => (
            <Bar key={name} dataKey={name} stackId="a" fill={COLORS[i % COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
