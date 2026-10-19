/**
 * @bv/sdk — tracking SDK (stage 2).
 * - in-memory queue + batching (maxBatchSize개 또는 flushIntervalMs마다 flush)
 * - pagehide / visibilitychange(hidden) 시 navigator.sendBeacon (실패 시 fetch keepalive)
 * - 전송 실패 배치는 localStorage에 보관(최대 maxStoredEvents) → online 이벤트/다음 로드 시 재전송
 */
export interface TrackerOptions {
  /** API base URL, e.g. http://localhost:4000 */
  endpoint: string;
  /** 이 개수가 쌓이면 즉시 flush (기본 20, 서버 최대 100) */
  maxBatchSize?: number;
  /** 주기적 flush 간격 ms (기본 5000) */
  flushIntervalMs?: number;
  /** 오프라인 보관 최대 이벤트 수 (기본 500, 초과 시 오래된 것부터 버림) */
  maxStoredEvents?: number;
  /**
   * 배치 전송 1건이 끝날 때마다 호출 (시각화/모니터링용, 선택).
   * 콜백에서 던진 예외는 SDK 동작에 영향을 주지 않는다.
   */
  onSend?: (info: SendInfo) => void;
}

export type FlushReason = 'size' | 'interval' | 'manual' | 'retry' | 'unload';

export interface SendInfo {
  /** 이번 요청 1건에 실린 이벤트 수 */
  size: number;
  /** HTTP 상태 코드 (네트워크 오류 0, beacon은 큐잉 성공 시 0) */
  status: number;
  /** 서버가 받았거나(2xx) 재시도 불필요로 판단해 버린 경우 true */
  ok: boolean;
  /** 실패해서 localStorage에 보관됐는지 */
  stored: boolean;
  durationMs: number;
  transport: 'fetch' | 'beacon';
  reason: FlushReason;
}

export interface TrackedEvent {
  name: string;
  properties: Record<string, unknown>;
  sessionId: string;
  /** 클라이언트 발생 시각 (ISO) */
  occurredAt: string;
}

export interface Tracker {
  sessionId: string;
  /** 큐에 적재 (네트워크 전송은 배치로) */
  track(name: string, properties?: Record<string, unknown>): void;
  /** 큐를 즉시 전송, 이번 flush로 서버에 전송 성공한 이벤트 수를 반환 */
  flush(): Promise<number>;
  /** 아직 전송 대기 중인 이벤트 수 */
  pending(): number;
  /** 타이머/리스너 해제 (남은 큐는 beacon으로 전송) */
  destroy(): void;
}

const SESSION_KEY = 'bv_session_id';
const STORE_KEY = 'bv_pending_events';
const MAX_SERVER_BATCH = 100;

type BrowserGlobals = {
  crypto?: Crypto;
  sessionStorage?: Storage;
  localStorage?: Storage;
  navigator?: Navigator;
  addEventListener?: typeof addEventListener;
  removeEventListener?: typeof removeEventListener;
  document?: Document;
};
const browserGlobals = globalThis as BrowserGlobals;

function randomId(): string {
  if (browserGlobals.crypto?.randomUUID) return browserGlobals.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getSessionId(): string {
  try {
    const sessionStore = browserGlobals.sessionStorage;
    if (sessionStore) {
      const existing = sessionStore.getItem(SESSION_KEY);
      if (existing) return existing;
      const newSessionId = randomId();
      sessionStore.setItem(SESSION_KEY, newSessionId);
      return newSessionId;
    }
  } catch {
    // sessionStorage 접근 불가 (privacy mode 등)
  }
  return randomId();
}

function loadStored(): TrackedEvent[] {
  try {
    const raw = browserGlobals.localStorage?.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as TrackedEvent[]) : [];
  } catch {
    return [];
  }
}

function saveStored(events: TrackedEvent[], maxEvents: number): void {
  try {
    const localStore = browserGlobals.localStorage;
    if (!localStore) return;
    if (events.length === 0) localStore.removeItem(STORE_KEY);
    else localStore.setItem(STORE_KEY, JSON.stringify(events.slice(-maxEvents)));
  } catch {
    // quota 초과 등은 무시 (best effort)
  }
}

const eventKey = (event: TrackedEvent) => `${event.sessionId}|${event.occurredAt}|${event.name}`;

export function createTracker(options: TrackerOptions): Tracker {
  const baseUrl = options.endpoint.replace(/\/+$/, '');
  const url = `${baseUrl}/events/batch`;
  const maxBatch = Math.min(Math.max(options.maxBatchSize ?? 20, 1), MAX_SERVER_BATCH);
  const interval = options.flushIntervalMs ?? 5000;
  const maxStored = options.maxStoredEvents ?? 500;
  const sessionId = getSessionId();

  let queue: TrackedEvent[] = [];
  let inflight: Promise<void> | null = null;

  const persist = (events: TrackedEvent[]) => saveStored([...loadStored(), ...events], maxStored);

  const report = (info: SendInfo) => {
    try {
      options.onSend?.(info);
    } catch {
      // 콜백 오류 무시
    }
  };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  async function send(events: TrackedEvent[], reason: FlushReason): Promise<boolean> {
    const sendStartedAt = now();
    let status = 0;
    let accepted = false;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
        keepalive: true,
      });
      status = response.status;
      // 4xx(검증 실패)는 재시도해도 소용없으므로 버림, 429/5xx는 재시도 대상
      accepted =
        response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429);
    } catch {
      accepted = false;
    }
    report({
      size: events.length,
      status,
      ok: accepted,
      stored: !accepted,
      durationMs: now() - sendStartedAt,
      transport: 'fetch',
      reason,
    });
    return accepted;
  }

  async function flush(reason: FlushReason = 'manual'): Promise<number> {
    if (inflight) await inflight;
    if (queue.length === 0) return 0;
    const batches: TrackedEvent[][] = [];
    while (queue.length) batches.push(queue.splice(0, maxBatch));
    let sent = 0;
    inflight = (async () => {
      for (const batch of batches) {
        if (await send(batch, reason)) sent += batch.length;
        else persist(batch);
      }
    })();
    try {
      await inflight;
    } finally {
      inflight = null;
    }
    return sent;
  }

  /** 페이지 이탈 시: sendBeacon (Content-Type text/plain → CORS preflight 없음) */
  function flushBeacon(): void {
    if (queue.length === 0) return;
    const events = queue;
    queue = [];
    for (let i = 0; i < events.length; i += maxBatch) {
      const batch = events.slice(i, i + maxBatch);
      const body = JSON.stringify({ events: batch });
      let beaconQueued = false;
      try {
        beaconQueued =
          browserGlobals.navigator?.sendBeacon?.(url, new Blob([body], { type: 'text/plain' })) ??
          false;
      } catch {
        beaconQueued = false;
      }
      if (beaconQueued) {
        report({
          size: batch.length,
          status: 0,
          ok: true,
          stored: false,
          durationMs: 0,
          transport: 'beacon',
          reason: 'unload',
        });
      } else {
        // beacon 불가 → 먼저 localStorage에 보관(페이지가 곧 사라질 수 있음) 후 fetch keepalive 시도,
        // 성공하면 보관분에서 제거
        persist(batch);
        const keys = new Set(batch.map(eventKey));
        void send(batch, 'unload').then(
          (sent) =>
            sent &&
            saveStored(
              loadStored().filter((event) => !keys.has(eventKey(event))),
              maxStored,
            ),
        );
      }
    }
  }

  async function resendStored(): Promise<void> {
    const stored = loadStored();
    if (stored.length === 0) return;
    saveStored([], maxStored);
    for (let i = 0; i < stored.length; i += maxBatch) {
      const batch = stored.slice(i, i + maxBatch);
      if (!(await send(batch, 'retry'))) persist(batch);
    }
  }

  const onHidden = () => {
    if (browserGlobals.document?.visibilityState === 'hidden') flushBeacon();
  };
  const onPageHide = () => flushBeacon();
  const onOnline = () => void resendStored();

  const timer = setInterval(() => void flush('interval'), interval);
  browserGlobals.addEventListener?.('pagehide', onPageHide);
  browserGlobals.addEventListener?.('online', onOnline);
  browserGlobals.document?.addEventListener('visibilitychange', onHidden);
  void resendStored();

  return {
    sessionId,
    track(name, properties = {}) {
      queue.push({ name, properties, sessionId, occurredAt: new Date().toISOString() });
      if (queue.length >= maxBatch) void flush('size');
    },
    flush: () => flush('manual'),
    pending: () => queue.length,
    destroy() {
      clearInterval(timer);
      browserGlobals.removeEventListener?.('pagehide', onPageHide);
      browserGlobals.removeEventListener?.('online', onOnline);
      browserGlobals.document?.removeEventListener('visibilitychange', onHidden);
      flushBeacon();
    },
  };
}
