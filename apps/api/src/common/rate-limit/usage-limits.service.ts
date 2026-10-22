import { ConflictException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { appEnvironment } from '../config/app-environment';
import { RedisService } from '../../redis/redis.service';
import { SharedSimulationGate } from './shared-simulation-gate';
import { ConcurrencyLimit, Cooldown, type LimitDecision, SlidingWindowLimit } from './usage-limits';

const MINUTE_MS = 60_000;

/** 서버 전체 공용 한도 모음 (IP별 한도는 ThrottlerGuard가 담당) */
@Injectable()
export class UsageLimitsService {
  private readonly limits = appEnvironment.limits;
  readonly storedEventsPerMinute = new SlidingWindowLimit(
    this.limits.eventsPerMinuteGlobal,
    MINUTE_MS,
  );
  readonly rateLimitProbesPerMinute = new SlidingWindowLimit(
    this.limits.rateLimitProbePerMinuteGlobal,
    MINUTE_MS,
  );
  readonly streamConnections = new ConcurrencyLimit(this.limits.maxStreamConnections);
  readonly aggregationDemoCooldown = new Cooldown(this.limits.aggregationCooldownMs);
  // 1장·4장·6장 시뮬레이션: 장마다 따로 "동시에 하나 + 쿨다운". API가 여러 개여도 Redis로 전체에서 하나
  readonly couponSimulation: SharedSimulationGate;
  readonly pointSimulation: SharedSimulationGate;
  readonly cacheExperiment: SharedSimulationGate;

  constructor(redis: RedisService) {
    const cooldownMs = this.limits.simulationCooldownMs;
    this.couponSimulation = new SharedSimulationGate(redis, 'coupon', cooldownMs);
    this.pointSimulation = new SharedSimulationGate(redis, 'point', cooldownMs);
    this.cacheExperiment = new SharedSimulationGate(redis, 'cache', cooldownMs);
  }

  /** gate가 비어 있으면 work를 실행. 실행 중이면 409, 쿨다운 중이면 429 */
  async runSimulation<T>(gate: SharedSimulationGate, response: Response, work: () => Promise<T>) {
    const { decision, finish } = await gate.tryStart();
    if (decision === 'running') throw new ConflictException('다른 시뮬레이션이 실행 중입니다');
    this.enforce(
      decision,
      response,
      'simulation_cooldown',
      '방금 시뮬레이션이 끝났습니다. 잠시 후 다시 실행하세요',
    );
    try {
      return await work();
    } finally {
      await finish();
    }
  }

  /** 거절이면 Retry-After 헤더를 달고 429를 던진다 */
  enforce(decision: LimitDecision, response: Response, reason: string, message: string) {
    if (decision.allowed) return;
    const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    response.setHeader('Retry-After', String(retryAfterSeconds));
    throw new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, reason, message, retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
