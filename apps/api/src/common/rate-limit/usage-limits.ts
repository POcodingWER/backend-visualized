/**
 * 공개 데모 남용 방지용 전역 한도 (IP와 무관하게 서버 전체 기준).
 * 각 API 프로세스 메모리에 저장한다.
 * 7장: API가 2개라 아래 한도들은 API마다 따로 센다(사실상 2배). 넉넉하게 잡은 한도라 그대로 둔다.
 * ponytail: 엄격한 전역 한도가 필요하면 Redis INCR + EXPIRE로. 요청마다 Redis 왕복이 하나 는다.
 * "동시에 하나"인 시뮬레이션만은 데모 데이터가 겹치면 안 돼서 Redis로 옮겼다 (shared-simulation-gate.ts).
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

/**
 * 무거운 시뮬레이션(DB 커넥션을 많이 씀): 이 프로세스 안에서 동시에 하나만 + 끝난 시점부터 쿨다운.
 * 평소엔 SharedSimulationGate가 Redis로 막고, Redis가 응답하지 않을 때만 이걸 쓴다.
 * 실제 거절(409/429)은 UsageLimitsService.runSimulation이 한다.
 */
export class SimulationGate {
  private running = false;
  readonly cooldown: Cooldown;

  constructor(cooldownMs: number, now: Clock = Date.now) {
    this.cooldown = new Cooldown(cooldownMs, now);
  }

  /** 'running': 다른 실행이 아직 안 끝남. 아니면 쿨다운 판정 (허용되면 실행 중으로 표시) */
  tryStart(): 'running' | LimitDecision {
    if (this.running) return 'running';
    const decision = this.cooldown.tryStart();
    if (decision.allowed) this.running = true;
    return decision;
  }

  finish() {
    this.running = false;
    this.cooldown.restartFromNow();
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
