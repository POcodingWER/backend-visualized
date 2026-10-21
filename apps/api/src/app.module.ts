import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { appEnvironment } from './common/config/app-environment';
import { loggerParams } from './common/observability/logger';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { EventsModule } from './events/events.module';
import { CouponsModule } from './coupons/coupons.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { PointsModule } from './points/points.module';
import { PaymentsModule } from './payments/payments.module';
import { CacheDemoModule } from './cache-demo/cache-demo.module';

@Module({
  imports: [
    // 요청마다 request-id가 붙는 JSON 로그 (운영) / 읽기 좋은 로그 (개발)
    LoggerModule.forRoot(loggerParams(appEnvironment.isProduction)),
    // IP별 기본 한도 (ThrottlerGuard를 붙인 라우트에만 적용, 라우트별 @Throttle로 덮어씀). IP는 TRUST_PROXY 설정을 따른 req.ip
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL_MS ?? 10_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 200),
      },
    ]),
    ScheduleModule.forRoot(),
    CommonModule,
    PrismaModule,
    HealthModule,
    EventsModule,
    CouponsModule,
    AuthModule,
    PointsModule,
    PaymentsModule,
    CacheDemoModule,
  ],
})
export class AppModule {}
