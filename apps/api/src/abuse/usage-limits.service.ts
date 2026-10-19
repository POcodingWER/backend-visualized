import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { appEnvironment } from '../config/app-environment';
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
  readonly couponSimulationCooldown = new Cooldown(this.limits.couponSimulationCooldownMs);

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
