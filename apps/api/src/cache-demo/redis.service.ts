import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { appEnvironment } from '../config/app-environment';

/** Redis 연결 하나. 첫 명령 때 연결(lazy) → Redis가 꺼져 있어도 서버는 뜨고 6장 요청만 실패한다 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);

  constructor() {
    super(appEnvironment.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    let lastLoggedAt = 0;
    this.on('error', (error: Error) => {
      // 끊긴 동안 재시도마다 찍히지 않게 30초에 한 번만
      if (Date.now() - lastLoggedAt < 30_000) return;
      lastLoggedAt = Date.now();
      this.log.warn(`redis: ${error.message}`);
    });
  }

  async onModuleDestroy() {
    await this.quit().catch(() => this.disconnect());
  }
}
