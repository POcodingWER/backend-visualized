import {
  Body,
  Controller,
  Get,
  HttpCode,
  MessageEvent,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Observable, finalize, interval, map, merge } from 'rxjs';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { UsageLimitsService } from '../common/rate-limit/usage-limits.service';
import { AggregationService } from './lib/aggregation.service';
import { BatchEventsDto, CreateEventDto, StatsQueryDto } from './dto/events.dto';
import { EventBus } from './lib/event-bus';
import { EventsService } from './events.service';

/** 3장 묶음배송: 클릭 이벤트 수집 · 통계 · 실시간 스트림 + 같은 이벤트의 데모/관리자 집계 버튼 */
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly agg: AggregationService,
    private readonly bus: EventBus,
    private readonly usageLimits: UsageLimitsService,
  ) {}

  /** IP별 한도(ThrottlerGuard)와 별개로, 서버 전체에 분당 저장 이벤트 수 상한 */
  private enforceGlobalIngestLimit(eventCount: number, response: Response) {
    this.usageLimits.enforce(
      this.usageLimits.storedEventsPerMinute.tryConsume(eventCount),
      response,
      'global_ingest_limit',
      '서버 전체 이벤트 수집 한도를 넘었습니다. 잠시 후 다시 보내주세요',
    );
  }

  @Post()
  @UseGuards(ThrottlerGuard)
  create(@Body() dto: CreateEventDto, @Res({ passthrough: true }) response: Response) {
    this.enforceGlobalIngestLimit(1, response);
    return this.events.create(dto);
  }

  @Post('batch')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard)
  createBatch(@Body() dto: BatchEventsDto, @Res({ passthrough: true }) response: Response) {
    this.enforceGlobalIngestLimit(dto.events.length, response);
    return this.events.createBatch(dto.events);
  }

  @Get('stats')
  stats(@Query() q: StatsQueryDto) {
    return this.events.stats(q.from, q.to);
  }

  @Get('stats/daily')
  daily(@Query() q: StatsQueryDto) {
    return this.agg.daily(q.from, q.to);
  }

  /** SSE: 새 이벤트가 저장될 때마다 {added, at} push, 15초마다 ping */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    // 연결마다 소켓을 계속 잡고 있으므로 전체 동시 연결 수를 제한
    const release = this.usageLimits.streamConnections.tryAcquire();
    if (!release)
      throw new ServiceUnavailableException({
        statusCode: 503,
        reason: 'too_many_stream_connections',
        message: '실시간 스트림 동시 연결 한도에 도달했습니다',
      });
    return merge(
      this.bus.ingested$.pipe(map((ingested) => ({ type: 'ingested', data: ingested }))),
      interval(15_000).pipe(map(() => ({ type: 'ping', data: { at: new Date().toISOString() } }))),
    ).pipe(finalize(release));
  }

  /**
   * 파이프라인 페이지의 '지금 집계 실행' 버튼: 어제~오늘(KST)만 재집계.
   * 비밀값 없이 호출 가능한 대신 IP별 한도 + 전역 쿨다운이라 여러 명이 눌러도 DB 부하는 일정
   */
  @Post('demo/aggregate')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async aggregateForDemo(@Res({ passthrough: true }) response: Response) {
    this.usageLimits.enforce(
      this.usageLimits.aggregationDemoCooldown.tryStart(),
      response,
      'aggregation_cooldown',
      '방금 다른 요청이 집계를 실행했습니다. 잠시 후 다시 시도하세요',
    );
    const result = await this.agg.aggregateRange();
    return {
      ...result,
      cooldownSeconds: Math.ceil(this.usageLimits.aggregationDemoCooldown.cooldownMs / 1000),
    };
  }

  /**
   * 레이트 리밋 체험 버튼: DB에 쓰지 않고 IP별 한도(10초 200회)만 체험한다.
   * 공개 서버에서 버튼 한 번에 이벤트 수백 행이 쌓이지 않도록 /events/batch 대신 사용.
   */
  @Post('demo/rate-limit-probe')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard)
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

  /** 관리자용 수동 집계 (임의 기간 지정 가능). X-Admin-Api-Key 헤더 필요 */
  @Post('admin/aggregate')
  @UseGuards(AdminApiKeyGuard)
  aggregateForAdmin(@Query() query: StatsQueryDto) {
    return this.agg.aggregateRange(query.from, query.to);
  }
}
