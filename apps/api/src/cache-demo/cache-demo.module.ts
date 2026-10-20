import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { CacheDemoController } from './cache-demo.controller';
import { CacheDemoService } from './cache-demo.service';

@Module({
  imports: [RedisModule],
  controllers: [CacheDemoController],
  providers: [CacheDemoService],
})
export class CacheDemoModule {}
