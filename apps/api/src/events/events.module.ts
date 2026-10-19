import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AggregationService } from './aggregation.service';
import { EventBus } from './event-bus';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  controllers: [EventsController, AdminController],
  providers: [EventsService, AggregationService, EventBus],
})
export class EventsModule {}
