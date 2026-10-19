import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AggregationService } from './aggregation.service';
import { EventBus } from './event-bus';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { PipelineDemoController } from './pipeline-demo.controller';

@Module({
  controllers: [EventsController, AdminController, PipelineDemoController],
  providers: [EventsService, AggregationService, EventBus],
})
export class EventsModule {}
