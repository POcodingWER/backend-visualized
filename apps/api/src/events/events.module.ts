import { Module } from '@nestjs/common';
import { AggregationService } from './aggregation.service';
import { EventBus } from './event-bus';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  controllers: [EventsController],
  providers: [EventsService, AggregationService, EventBus],
})
export class EventsModule {}
