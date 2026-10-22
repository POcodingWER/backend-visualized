import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { type LimitDecision, SimulationGate } from './usage-limits';

/** 실행 중에 서버가 죽어도 이 시간이 지나면 잠금이 저절로 풀린다 */
const MAX_RUN_MS = 120_000;

/** 내 토큰일 때만 잠금을 푼다 (남의 잠금을 지우지 않게) */
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

/** 내 잠금을 풀고, 끝난 시점부터 쿨다운을 건다 */
const RELEASE_AND_COOL_DOWN = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
if tonumber(ARGV[2]) > 0 then redis.call('SET', KEYS[2], '1', 'PX', ARGV[2]) end
return 1`;

export interface GateTicket {
  /** 'running': 다른 실행이 아직 안 끝남. 아니면 쿨다운 판정 */
  decision: 'running' | LimitDecision;
  /** 실행이 끝나면 꼭 호출. 허용되지 않았으면 아무것도 안 한다 */
  finish: () => Promise<void>;
}

type GateRedis = Pick<Redis, 'set' | 'pttl' | 'eval'>;

const NOTHING_TO_FINISH = async () => {};

/**
 * 무거운 시뮬레이션: API가 몇 개든 "전체에서 동시에 하나 + 끝난 시점부터 쿨다운".
 * 7장에서 API가 2개가 되면서 프로세스 메모리(SimulationGate) 대신 Redis에 둔다.
 * Redis가 응답하지 않으면 이 프로세스 안에서만 막는다 (예전 방식, API마다 하나씩).
 */
export class SharedSimulationGate {
  private readonly runningKey: string;
  private readonly cooldownKey: string;
  private readonly localGate: SimulationGate;

  constructor(
    private readonly redis: GateRedis,
    name: string,
    private readonly cooldownMs: number,
  ) {
    this.runningKey = `bv:simulation:${name}:running`;
    this.cooldownKey = `bv:simulation:${name}:cooldown`;
    this.localGate = new SimulationGate(cooldownMs);
  }

  async tryStart(): Promise<GateTicket> {
    const token = randomUUID();
    let acquired: boolean;
    try {
      acquired = (await this.redis.set(this.runningKey, token, 'PX', MAX_RUN_MS, 'NX')) === 'OK';
    } catch {
      return this.tryStartLocally();
    }
    if (!acquired) return { decision: 'running', finish: NOTHING_TO_FINISH };

    const cooldownLeftMs = await this.redis.pttl(this.cooldownKey).catch(() => 0);
    if (cooldownLeftMs > 0) {
      await this.redis.eval(RELEASE, 1, this.runningKey, token).catch(() => undefined);
      return {
        decision: { allowed: false, retryAfterMs: cooldownLeftMs },
        finish: NOTHING_TO_FINISH,
      };
    }

    return {
      decision: { allowed: true, retryAfterMs: 0 },
      finish: async () => {
        await this.redis
          .eval(
            RELEASE_AND_COOL_DOWN,
            2,
            this.runningKey,
            this.cooldownKey,
            token,
            String(this.cooldownMs),
          )
          .catch(() => undefined);
      },
    };
  }

  private tryStartLocally(): GateTicket {
    const decision = this.localGate.tryStart();
    const started = decision !== 'running' && decision.allowed;
    return {
      decision,
      finish: started ? async () => this.localGate.finish() : NOTHING_TO_FINISH,
    };
  }
}
