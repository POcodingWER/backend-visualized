'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { API_URL } from '../lib/api';

interface Stats {
  total: number;
  byName: { name: string; count: number }[];
}

interface Daily {
  names: string[];
  series: { date: string; total: number; byName: Record<string, number> }[];
}

const COLORS = ['#4f46e5', '#16a34a', '#ea580c', '#0891b2', '#db2777', '#ca8a04'];

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [live, setLive] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        fetch(`${API_URL}/events/stats`, { cache: 'no-store' }),
        fetch(`${API_URL}/events/stats/daily`, { cache: 'no-store' }),
      ]);
      if (!s.ok || !d.ok) throw new Error(`HTTP ${s.status}/${d.status}`);
      setStats((await s.json()) as Stats);
      setDaily((await d.json()) as Daily);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const aggregate = async () => {
    await fetch(`${API_URL}/admin/aggregate`, { method: 'POST' });
    await load();
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  // SSE: 새로 저장된 이벤트 수를 실시간으로 누적
  useEffect(() => {
    const es = new EventSource(`${API_URL}/events/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('ingested', (e) => {
      const { added } = JSON.parse((e as MessageEvent<string>).data) as { added: number };
      setLive((n) => n + added);
    });
    return () => es.close();
  }, []);

  const chartData = daily?.series.map((p) => ({ date: p.date.slice(5), ...p.byName })) ?? [];

  return (
    <section>
      <h2>대시보드</h2>
      <p>
        실시간(SSE {connected ? '🟢 연결됨' : '🔴 끊김'}): 이 화면을 연 뒤 저장된 이벤트{' '}
        <strong>{live}</strong>개
      </p>
      <button onClick={load}>새로고침</button>{' '}
      <button onClick={aggregate}>일별 집계 지금 실행</button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {stats && (
        <>
          <p>
            전체 이벤트: <strong>{stats.total}</strong>
          </p>
          <table>
            <thead>
              <tr>
                <th align="left">name</th>
                <th align="right">count</th>
              </tr>
            </thead>
            <tbody>
              {stats.byName.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td align="right">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {daily && (
        <>
          <h3>최근 7일 (UTC 기준, EventDailyStat 집계 테이블)</h3>
          <div style={{ width: '100%', maxWidth: 720, height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                {daily.names.map((n, i) => (
                  <Bar key={n} dataKey={n} stackId="a" fill={COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}
