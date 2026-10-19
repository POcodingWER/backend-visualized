'use client';

import { createTracker, type Tracker } from '@bv/sdk';
import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../lib/api';

export default function TrackerDemo() {
  const tracker = useRef<Tracker | null>(null);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    if (tracker.current) return; // StrictMode 이중 실행 방지
    // 데모용: 10개 쌓이거나 2초마다 /events/batch 로 전송, 탭 이탈 시 sendBeacon
    tracker.current = createTracker({ endpoint: API_URL, maxBatchSize: 10, flushIntervalMs: 2000 });
    tracker.current.track('page_view', { path: window.location.pathname });
    setQueued((n) => n + 1);
  }, []);

  const click = (count: number) => {
    for (let i = 0; i < count; i++) tracker.current?.track('button_click', { button: 'demo' });
    setQueued((n) => n + count);
  };

  return (
    <section>
      <h2>이벤트 보내기</h2>
      <button onClick={() => click(1)}>button_click 보내기</button>{' '}
      <button onClick={() => click(50)}>button_click x50 (배치 확인)</button>{' '}
      <button onClick={() => void tracker.current?.flush()}>지금 flush</button>
      <p>
        이 탭에서 큐에 넣은 이벤트: {queued} <small>(10개 단위 또는 2초마다 배치 전송)</small>
      </p>
    </section>
  );
}
