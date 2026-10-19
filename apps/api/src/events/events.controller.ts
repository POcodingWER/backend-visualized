import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CreateEventDto, StatsQueryDto } from './create-event.dto';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  create(@Body() dto: CreateEventDto) {
    return this.events.create(dto);
  }

  @Get('stats')
  stats(@Query() q: StatsQueryDto) {
    return this.events.stats(q.from, q.to);
  }
}
