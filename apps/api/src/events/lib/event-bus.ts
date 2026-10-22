import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Subject } from 'rxjs';
import { RedisService } from '../../redis/redis.service';

export interface IngestedSignal {
  added: number;
  at: string;
}

/** API가 여러 개라도 모두 이 채널로 "방금 들어옴"을 주고받는다 */
export const INGESTED_CHANNEL = 'bv:events:ingested';

/** 이 버스가 쓰는 Redis 명령만. 테스트에선 가짜를 넣는다 */
export type BusRedis = Pick<Redis, 'publish' | 'duplicate'>;

/**
 * "방금 들어옴" 알림 버스.
 * 브라우저의 SSE(/events/stream)는 계산대 A에 붙어 있는데, /events/batch는 B로 갈 수 있다.
 * 그래서 emit은 Redis로 PUBLISH 하고, 모든 API가 SUBSCRIBE 해서 자기 Subject로 흘려준다 (자기 자신 포함).
 * Redis에 못 보내면 이 프로세스 안에서만 알린다 (예전 방식).
 */
@Injectable()
export class EventBus implements OnModuleInit, OnModuleDestroy {
  readonly ingested$ = new Subject<IngestedSignal>();
  private readonly log = new Logger(EventBus.name);
  /** 구독 중인 연결은 다른 명령을 못 쓰므로 따로 하나 둔다 */
  private subscriber?: Redis;

  constructor(@Inject(RedisService) private readonly redis: BusRedis) {}

  onModuleInit() {
    const subscriber = this.redis.duplicate();
    this.subscriber = subscriber;
    subscriber.on('message', (channel: string, message: string) => {
      if (channel !== INGESTED_CHANNEL) return;
      const signal = parseSignal(message);
      if (signal) this.ingested$.next(signal);
    });
    // 끊겼다 붙으면 ioredis가 다시 구독해 주지만, 처음 구독이 실패했을 때를 위해 ready마다 건다
    subscriber.on('ready', () => {
      subscriber.subscribe(INGESTED_CHANNEL).catch(() => {});
    });
    subscriber.subscribe(INGESTED_CHANNEL).catch((error: Error) => {
      this.log.warn(`redis subscribe 실패, 이 API 안에서만 알림: ${error.message}`);
    });
  }

  emit(added: number) {
    if (added <= 0) return;
    const signal: IngestedSignal = { added, at: new Date().toISOString() };
    // 보내기 성공이면 구독으로 돌아오니 여기선 next 하지 않는다 (두 번 알림 방지)
    this.redis.publish(INGESTED_CHANNEL, JSON.stringify(signal)).catch(() => {
      this.ingested$.next(signal);
    });
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => this.subscriber?.disconnect());
  }
}

function parseSignal(message: string): IngestedSignal | undefined {
  try {
    const value = JSON.parse(message) as Partial<IngestedSignal>;
    if (typeof value.added === 'number' && typeof value.at === 'string') {
      return { added: value.added, at: value.at };
    }
  } catch {
    // 형식이 다른 메시지는 버린다
  }
  return undefined;
}
