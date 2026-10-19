import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { EventsModule } from './events/events.module';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [HealthController],
})
export class AppModule {}
