import {
  Body,
  Controller,
  Get,
  HttpCode,
  MessageEvent,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Observable, interval, map, merge } from 'rxjs';
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
  ) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  create(@Body() dto: CreateEventDto) {
    return this.events.create(dto);
  }

  @Post('batch')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard)
  createBatch(@Body() dto: BatchEventsDto) {
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
    return merge(
      this.bus.ingested$.pipe(map((ingested) => ({ type: 'ingested', data: ingested }))),
      interval(15_000).pipe(map(() => ({ type: 'ping', data: { at: new Date().toISOString() } }))),
    );
  }
}
