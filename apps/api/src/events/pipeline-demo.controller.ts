import { Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { UsageLimitsService } from '../abuse/usage-limits.service';
import { AggregationService } from './aggregation.service';

/** 파이프라인 페이지의 공개 데모 버튼용 엔드포인트. 비밀값 없이 호출 가능한 대신 IP별 + 전역 한도가 있다 */
@Controller('demo')
@UseGuards(ThrottlerGuard)
export class PipelineDemoController {
  constructor(
    private readonly aggregation: AggregationService,
    private readonly usageLimits: UsageLimitsService,
  ) {}

  /** '지금 집계 실행' 버튼: 어제~오늘(KST)만 재집계. 전역 쿨다운이라 여러 명이 눌러도 DB 부하는 일정 */
  @Post('aggregate')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async aggregate(@Res({ passthrough: true }) response: Response) {
    this.usageLimits.enforce(
      this.usageLimits.aggregationDemoCooldown.tryStart(),
      response,
      'aggregation_cooldown',
      '방금 다른 요청이 집계를 실행했습니다. 잠시 후 다시 시도하세요',
    );
    const result = await this.aggregation.aggregateRange();
    return {
      ...result,
      cooldownSeconds: Math.ceil(this.usageLimits.aggregationDemoCooldown.cooldownMs / 1000),
    };
  }

  /**
   * 레이트 리밋 체험 버튼: DB에 쓰지 않고 IP별 한도(10초 200회)만 체험한다.
   * 공개 서버에서 버튼 한 번에 이벤트 수백 행이 쌓이지 않도록 /events/batch 대신 사용.
   */
  @Post('rate-limit-probe')
  @HttpCode(202)
  @Throttle({ default: { limit: 200, ttl: 10_000 } })
  rateLimitProbe(@Res({ passthrough: true }) response: Response) {
    this.usageLimits.enforce(
      this.usageLimits.rateLimitProbesPerMinute.tryConsume(),
      response,
      'global_demo_limit',
      '지금 이 데모를 쓰는 사람이 많습니다. 잠시 후 다시 시도하세요',
    );
    return { accepted: true };
  }
}
