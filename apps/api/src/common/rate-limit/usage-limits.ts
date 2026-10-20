/**
 * 공개 데모 남용 방지용 전역 한도 (IP와 무관하게 서버 전체 기준).
 * 단일 API 인스턴스 메모리에 저장한다 — 인스턴스를 여러 대로 늘리면 Redis 같은 공유 저장소로 옮겨야 한다.
 */

export interface LimitDecision {
  allowed: boolean;
  /** 거절됐을 때 다시 시도해도 되는 시점까지 남은 시간 */
  retryAfterMs: number;
}

const ALLOWED: LimitDecision = { allowed: true, retryAfterMs: 0 };
type Clock = () => number;

/** 최근 windowMs 동안의 사용량 합이 limit을 넘지 않게 한다. 1초 단위 버킷이라 메모리는 버킷 수만큼만 쓴다 */
export class SlidingWindowLimit {
  private readonly buckets = new Map<number, number>();
  private used = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: Clock = Date.now,
    private readonly bucketMs = 1_000,
  ) {}

  /** limit 0 = 무제한 */
  tryConsume(amount = 1): LimitDecision {
    if (this.limit <= 0) return ALLOWED;
    const now = this.now();
    this.evictOlderThan(now - this.windowMs);
    if (this.used + amount > this.limit) {
      const oldestBucketStart = Math.min(...this.buckets.keys());
      const retryAfterMs = Number.isFinite(oldestBucketStart)
        ? Math.max(1, oldestBucketStart + this.bucketMs + this.windowMs - now)
        : this.windowMs;
      return { allowed: false, retryAfterMs };
    }
    const bucketStart = Math.floor(now / this.bucketMs) * this.bucketMs;
    this.buckets.set(bucketStart, (this.buckets.get(bucketStart) ?? 0) + amount);
    this.used += amount;
    return ALLOWED;
  }

  get usedInWindow(): number {
    this.evictOlderThan(this.now() - this.windowMs);
    return this.used;
  }

  private evictOlderThan(threshold: number) {
    for (const [bucketStart, amount] of this.buckets) {
      if (bucketStart + this.bucketMs > threshold) continue;
      this.buckets.delete(bucketStart);
      this.used -= amount;
    }
  }
}

/** 한 번 실행되면 cooldownMs 동안 다시 실행하지 못하게 한다 (모든 사용자 공통) */
export class Cooldown {
  private nextAllowedAt = 0;

  constructor(
    readonly cooldownMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  tryStart(): LimitDecision {
    if (this.cooldownMs <= 0) return ALLOWED;
    const now = this.now();
    if (now < this.nextAllowedAt) return { allowed: false, retryAfterMs: this.nextAllowedAt - now };
    this.nextAllowedAt = now + this.cooldownMs;
    return ALLOWED;
  }

  /** 오래 걸리는 작업은 끝난 시점부터 다시 쿨다운을 센다 */
  restartFromNow() {
    if (this.cooldownMs > 0) this.nextAllowedAt = this.now() + this.cooldownMs;
  }
}

/** 동시에 열린 연결 수 제한. tryAcquire()가 돌려준 release를 연결이 끝날 때 꼭 호출 */
export class ConcurrencyLimit {
  private active = 0;

  constructor(readonly maxConcurrent: number) {}

  tryAcquire(): (() => void) | null {
    if (this.maxConcurrent > 0 && this.active >= this.maxConcurrent) return null;
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
    };
  }

  get activeCount(): number {
    return this.active;
  }
}
