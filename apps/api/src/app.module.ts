import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { EventsModule } from './events/events.module';
import { CouponsModule } from './coupons/coupons.module';
import { AuthModule } from './auth/auth.module';
import { AbuseModule } from './abuse/abuse.module';

@Module({
  imports: [
    // IP별 기본 한도 (ThrottlerGuard를 붙인 라우트에만 적용, 라우트별 @Throttle로 덮어씀). IP는 TRUST_PROXY 설정을 따른 req.ip
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL_MS ?? 10_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 200),
      },
    ]),
    ScheduleModule.forRoot(),
    AbuseModule,
    PrismaModule,
    EventsModule,
    CouponsModule,
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
