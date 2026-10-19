import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { EventsModule } from './events/events.module';
import { CouponsModule } from './coupons/coupons.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // 수집 엔드포인트(POST /events, /events/batch)에만 가드 적용. IP당 THROTTLE_LIMIT req / THROTTLE_TTL_MS
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL_MS ?? 10_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 200),
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    EventsModule,
    CouponsModule,
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
