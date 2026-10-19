'use client';

import { createTracker, type Tracker } from '@bv/sdk';
import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../lib/api';

const FLUSH_INTERVAL_MS = 10000;
const MAX_BATCH = 10;

export default function TrackerDemo() {
  const tracker = useRef<Tracker | null>(null);
  const [queued, setQueued] = useState(0);
  const [pending, setPending] = useState(0);
  const [lastFlush, setLastFlush] = useState<string | null>(null);

  useEffect(() => {
    if (!tracker.current) {
      // 데모용: 10개 쌓이거나 10초마다 /events/batch 로 전송, 탭 이탈 시 sendBeacon
      tracker.current = createTracker({
        endpoint: API_URL,
        maxBatchSize: MAX_BATCH,
        flushIntervalMs: FLUSH_INTERVAL_MS,
      });
      tracker.current.track('page_view', { path: window.location.pathname });
      setQueued((n) => n + 1);
    }
    // 대기 중 큐 개수를 화면에 반영
    const id = setInterval(() => setPending(tracker.current?.pending() ?? 0), 200);
    return () => clearInterval(id);
  }, []);

  const click = (count: number) => {
    for (let i = 0; i < count; i++) tracker.current?.track('button_click', { button: 'demo' });
    setQueued((n) => n + count);
    setPending(tracker.current?.pending() ?? 0);
  };

  const flushNow = async () => {
    const t = tracker.current;
    if (!t) return;
    const before = t.pending();
    if (before === 0) {
      setLastFlush('보낼 이벤트가 없어요 (이미 자동 전송됨)');
      return;
    }
    const sent = await t.flush();
    setPending(t.pending());
    setLastFlush(
      sent === before
        ? `${sent}개 전송 완료`
        : `${sent}/${before}개 전송, 실패분은 localStorage에 보관 후 재전송`,
    );
  };

  return (
    <section>
      <h2>이벤트 보내기</h2>
      <button onClick={() => click(1)}>button_click 보내기</button>{' '}
      <button onClick={() => click(50)}>button_click x50 (배치 확인)</button>{' '}
      <button onClick={() => void flushNow()}>지금 flush</button>
      <p>
        전송 대기 중: <strong>{pending}</strong>개 · 이 탭에서 큐에 넣은 이벤트: {queued}{' '}
        <small>({MAX_BATCH}개 쌓이거나 {FLUSH_INTERVAL_MS / 1000}초마다 자동 배치 전송)</small>
      </p>
      {lastFlush && <p>마지막 flush: {lastFlush}</p>}
    </section>
  );
}
