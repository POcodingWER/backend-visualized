'use client';

import { createTracker, type Tracker } from '@bv/sdk';
import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../lib/api';

export default function TrackerDemo() {
  const tracker = useRef<Tracker | null>(null);
  const [sent, setSent] = useState(0);

  useEffect(() => {
    if (tracker.current) return; // StrictMode 이중 실행 방지
    tracker.current = createTracker({ endpoint: API_URL });
    void tracker.current.track('page_view', { path: window.location.pathname });
    setSent((n) => n + 1);
  }, []);

  return (
    <section>
      <h2>이벤트 보내기</h2>
      <button
        onClick={() => {
          void tracker.current?.track('button_click', { button: 'demo' });
          setSent((n) => n + 1);
        }}
      >
        button_click 보내기
      </button>
      <p>이 탭에서 보낸 이벤트: {sent}</p>
    </section>
  );
}
