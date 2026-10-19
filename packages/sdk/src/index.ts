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
  /** 큐를 즉시 전송 */
  flush(): Promise<void>;
  /** 타이머/리스너 해제 (남은 큐는 beacon으로 전송) */
  destroy(): void;
}

const SESSION_KEY = 'bv_session_id';
const STORE_KEY = 'bv_pending_events';
const MAX_SERVER_BATCH = 100;

type G = {
  crypto?: Crypto;
  sessionStorage?: Storage;
  localStorage?: Storage;
  navigator?: Navigator;
  addEventListener?: typeof addEventListener;
  removeEventListener?: typeof removeEventListener;
  document?: Document;
};
const g = globalThis as G;

function randomId(): string {
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getSessionId(): string {
  try {
    const ss = g.sessionStorage;
    if (ss) {
      const existing = ss.getItem(SESSION_KEY);
      if (existing) return existing;
      const id = randomId();
      ss.setItem(SESSION_KEY, id);
      return id;
    }
  } catch {
    // sessionStorage 접근 불가 (privacy mode 등)
  }
  return randomId();
}

function loadStored(): TrackedEvent[] {
  try {
    const raw = g.localStorage?.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as TrackedEvent[]) : [];
  } catch {
    return [];
  }
}

function saveStored(events: TrackedEvent[], max: number): void {
  try {
    const ls = g.localStorage;
    if (!ls) return;
    if (events.length === 0) ls.removeItem(STORE_KEY);
    else ls.setItem(STORE_KEY, JSON.stringify(events.slice(-max)));
  } catch {
    // quota 초과 등은 무시 (best effort)
  }
}

const eventKey = (e: TrackedEvent) => `${e.sessionId}|${e.occurredAt}|${e.name}`;

export function createTracker(opts: TrackerOptions): Tracker {
  const base = opts.endpoint.replace(/\/+$/, '');
  const url = `${base}/events/batch`;
  const maxBatch = Math.min(Math.max(opts.maxBatchSize ?? 20, 1), MAX_SERVER_BATCH);
  const interval = opts.flushIntervalMs ?? 5000;
  const maxStored = opts.maxStoredEvents ?? 500;
  const sessionId = getSessionId();

  let queue: TrackedEvent[] = [];
  let inflight: Promise<void> | null = null;

  const persist = (events: TrackedEvent[]) => saveStored([...loadStored(), ...events], maxStored);

  async function send(events: TrackedEvent[]): Promise<boolean> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
        keepalive: true,
      });
      // 4xx(검증 실패)는 재시도해도 소용없으므로 버림, 429/5xx는 재시도 대상
      return res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);
    } catch {
      return false;
    }
  }

  async function flush(): Promise<void> {
    if (inflight) await inflight;
    if (queue.length === 0) return;
    const batches: TrackedEvent[][] = [];
    while (queue.length) batches.push(queue.splice(0, maxBatch));
    inflight = (async () => {
      for (const b of batches) if (!(await send(b))) persist(b);
    })();
    try {
      await inflight;
    } finally {
      inflight = null;
    }
  }

  /** 페이지 이탈 시: sendBeacon (Content-Type text/plain → CORS preflight 없음) */
  function flushBeacon(): void {
    if (queue.length === 0) return;
    const events = queue;
    queue = [];
    for (let i = 0; i < events.length; i += maxBatch) {
      const b = events.slice(i, i + maxBatch);
      const body = JSON.stringify({ events: b });
      let ok = false;
      try {
        ok = g.navigator?.sendBeacon?.(url, new Blob([body], { type: 'text/plain' })) ?? false;
      } catch {
        ok = false;
      }
      if (!ok) {
        // beacon 불가 → 먼저 localStorage에 보관(페이지가 곧 사라질 수 있음) 후 fetch keepalive 시도,
        // 성공하면 보관분에서 제거
        persist(b);
        const keys = new Set(b.map(eventKey));
        void send(b).then(
          (sent) =>
            sent &&
            saveStored(
              loadStored().filter((e) => !keys.has(eventKey(e))),
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
      const b = stored.slice(i, i + maxBatch);
      if (!(await send(b))) persist(b);
    }
  }

  const onHidden = () => {
    if (g.document?.visibilityState === 'hidden') flushBeacon();
  };
  const onPageHide = () => flushBeacon();
  const onOnline = () => void resendStored();

  const timer = setInterval(() => void flush(), interval);
  g.addEventListener?.('pagehide', onPageHide);
  g.addEventListener?.('online', onOnline);
  g.document?.addEventListener('visibilitychange', onHidden);
  void resendStored();

  return {
    sessionId,
    track(name, properties = {}) {
      queue.push({ name, properties, sessionId, occurredAt: new Date().toISOString() });
      if (queue.length >= maxBatch) void flush();
    },
    flush,
    destroy() {
      clearInterval(timer);
      g.removeEventListener?.('pagehide', onPageHide);
      g.removeEventListener?.('online', onOnline);
      g.document?.removeEventListener('visibilitychange', onHidden);
      flushBeacon();
    },
  };
}
