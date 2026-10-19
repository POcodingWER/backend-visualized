/**
 * @bv/sdk — tracking SDK (stage 1: 단건 fetch 전송).
 * Stage 2에서 sendBeacon / batching / offline retry를 추가합니다.
 */
export interface TrackerOptions {
  /** API base URL, e.g. http://localhost:4000 */
  endpoint: string;
}

export interface Tracker {
  sessionId: string;
  track(name: string, properties?: Record<string, unknown>): Promise<void>;
}

const SESSION_KEY = 'bv_session_id';

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getSessionId(): string {
  try {
    const ss = (globalThis as { sessionStorage?: Storage }).sessionStorage;
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

export function createTracker({ endpoint }: TrackerOptions): Tracker {
  const base = endpoint.replace(/\/+$/, '');
  const sessionId = getSessionId();
  return {
    sessionId,
    async track(name, properties = {}) {
      try {
        await fetch(`${base}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, properties, sessionId }),
          keepalive: true,
        });
      } catch (err) {
        console.warn('[bv/sdk] track failed', err);
      }
    },
  };
}
