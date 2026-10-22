'use client';

import { useState } from 'react';
import { Button } from '../components/atoms/Button';
import { apiHealthCheck } from './api';
import ui from '../components/ui.module.css';
import styles from './scale-out.module.css';

interface HealthResponse {
  status: string;
  instance: string;
  timestamp: string;
}

type ResultEntry =
  | { success: true; data: HealthResponse; index: number }
  | { success: false; error: string; index: number };

export default function ScaleOutDemo() {
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const handleMultipleRequests = async () => {
    setLoading(true);
    setResults([]);
    const promises = Array.from({ length: 10 }, (_, i) =>
      apiHealthCheck().then(
        (data) => ({ success: true as const, data, index: i }),
        (error: Error) => ({ success: false as const, error: error.message, index: i }),
      ),
    );
    const responses = await Promise.allSettled(promises);
    const entries = responses.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { success: false as const, error: '요청 실패', index: i },
    );
    setResults(entries);
    setLoading(false);
  };

  const successResults = results.filter(
    (r): r is Extract<ResultEntry, { success: true }> => r.success,
  );
  const failureCount = results.filter((r) => !r.success).length;
  const instanceCounts = successResults.reduce(
    (acc, r) => {
      acc[r.data.instance] = (acc[r.data.instance] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const instanceColors: Record<string, string> = {};
  const colorPalette = ['#f0f8ff', '#fff8f0', '#f0fff0', '#fff0f5'];
  Object.keys(instanceCounts).forEach((instance, i) => {
    instanceColors[instance] = colorPalette[i % colorPalette.length] ?? '#fafafa';
  });

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
        <div className={styles.results}>
          <h4>인스턴스별 응답 수</h4>
          <ul>
            {Object.entries(instanceCounts).map(([instance, count]) => (
              <li key={instance}>
                <strong>{instance}</strong>: {count}번
              </li>
            ))}
            {failureCount > 0 && <li className={styles.error}>실패: {failureCount}번</li>}
          </ul>

          <details className={styles.details}>
            <summary>
              <strong>요청별 상세</strong>
            </summary>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>순서</th>
                  <th>인스턴스</th>
                  <th>시각</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr
                    key={result.index}
                    className={result.success ? undefined : styles.failedRow}
                    style={
                      result.success
                        ? { backgroundColor: instanceColors[result.data.instance] }
                        : undefined
                    }
                  >
                    <td>{result.index + 1}</td>
                    <td>
                      {result.success ? <code>{result.data.instance}</code> : <span>실패</span>}
                    </td>
                    <td className={styles.time}>
                      {result.success
                        ? new Date(result.data.timestamp).toLocaleTimeString('ko-KR')
                        : result.error}
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
