import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { AggregationService } from './lib/aggregation.service';
import { EventBus } from './lib/event-bus';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [RedisModule],
  controllers: [EventsController],
  providers: [EventsService, AggregationService, EventBus],
})
export class EventsModule {}
