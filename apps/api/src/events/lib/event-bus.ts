import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface IngestedSignal {
  added: number;
  at: string;
}

/** 프로세스 내 이벤트 버스 (단일 인스턴스 전제, 멀티 인스턴스면 Redis pub/sub 등 필요) */
@Injectable()
export class EventBus {
  readonly ingested$ = new Subject<IngestedSignal>();
  emit(added: number) {
    if (added > 0) this.ingested$.next({ added, at: new Date().toISOString() });
  }
}
