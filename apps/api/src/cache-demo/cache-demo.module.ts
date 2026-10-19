import { Module } from '@nestjs/common';
import { CacheDemoController } from './cache-demo.controller';
import { RedisService } from './redis.service';

@Module({ controllers: [CacheDemoController], providers: [RedisService] })
export class CacheDemoModule {}
