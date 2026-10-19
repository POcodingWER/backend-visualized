'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../lib/api';

interface Stats {
  total: number;
  byName: { name: string; count: number }[];
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/events/stats`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStats((await res.json()) as Stats);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 300); // page_view 저장 후 조회
    return () => clearTimeout(t);
  }, [load]);

  return (
    <section>
      <h2>대시보드</h2>
      <button onClick={load}>새로고침</button>
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
    </section>
  );
}
