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
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Observable, finalize, interval, map, merge } from 'rxjs';
import { UsageLimitsService } from '../abuse/usage-limits.service';
import { AggregationService } from './aggregation.service';
import { BatchEventsDto, CreateEventDto, StatsQueryDto } from './create-event.dto';
import { EventBus } from './event-bus';
import { EventsService } from './events.service';

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
}
