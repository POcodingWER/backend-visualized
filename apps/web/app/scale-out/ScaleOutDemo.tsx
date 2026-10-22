'use client';

import { useState } from 'react';
import { Button } from '../components/atoms/Button';
import { apiHealthCheck } from './api';
import ui from '../components/atoms/common.module.css';

interface HealthResponse {
  status: string;
  instance: string;
  timestamp: string;
}

export default function ScaleOutDemo() {
  const [results, setResults] = useState<HealthResponse[]>([]);
  const [loading, setLoading] = useState(false);

  const handleMultipleRequests = async () => {
    setLoading(true);
    setResults([]);
    const promises = Array.from({ length: 10 }, () => apiHealthCheck());
    const responses = await Promise.all(promises);
    setResults(responses);
    setLoading(false);
  };

  const instanceCounts = results.reduce(
    (acc, r) => {
      acc[r.instance] = (acc[r.instance] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className={ui.demoBox}>
      <p>
        버튼을 누르면 <code>/health</code>를 10번 호출해요. 각 요청의 <code>x-instance-id</code>{' '}
        헤더로 어느 인스턴스가 응답했는지 볼 수 있어요.
      </p>
      <Button size="big" onClick={handleMultipleRequests} disabled={loading}>
        {loading ? '요청 중...' : '10번 호출하기'}
      </Button>

      {results.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h4>인스턴스별 응답 수</h4>
          <ul>
            {Object.entries(instanceCounts).map(([instance, count]) => (
              <li key={instance}>
                <strong>{instance}</strong>: {count}번
              </li>
            ))}
          </ul>

          <details style={{ marginTop: '1rem' }}>
            <summary>
              <strong>요청별 상세</strong>
            </summary>
            <table style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.9em' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>순서</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>인스턴스</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>시각</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, index) => (
                  <tr
                    key={index}
                    style={{
                      backgroundColor: result.instance.includes('1') ? '#f0f8ff' : '#fff8f0',
                    }}
                  >
                    <td style={{ padding: '0.5rem' }}>{index + 1}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <code>{result.instance}</code>
                    </td>
                    <td style={{ padding: '0.5rem', fontSize: '0.85em' }}>
                      {new Date(result.timestamp).toLocaleTimeString('ko-KR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  );
}
