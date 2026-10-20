import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** Redis 연결 하나를 만들어 필요한 모듈(지금은 cache-demo)에 넘겨준다. Prisma 모듈과 같은 역할 */
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
