import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { EventBus, type IngestedSignal, INGESTED_CHANNEL } from '../lib/event-bus';

/** API 여러 개가 같이 보는 Redis 하나. PUBLISH하면 구독한 연결 전부에 간다 */
class FakeRedisServer {
  down = false;
  readonly subscribers = new Set<FakeSubscriber>();
}

class FakeSubscriber extends EventEmitter {
  constructor(private readonly server: FakeRedisServer) {
    super();
  }
  async subscribe(channel: string) {
    if (this.server.down) throw new Error('connect ECONNREFUSED');
    if (channel === INGESTED_CHANNEL) this.server.subscribers.add(this);
    return 1;
  }
  async quit() {
    this.server.subscribers.delete(this);
    return 'OK';
  }
  disconnect() {}
}

class FakeRedis {
  constructor(private readonly server: FakeRedisServer) {}
  duplicate() {
    return new FakeSubscriber(this.server);
  }
  async publish(channel: string, message: string) {
    if (this.server.down) throw new Error('connect ECONNREFUSED');
    for (const subscriber of this.server.subscribers) subscriber.emit('message', channel, message);
    return this.server.subscribers.size;
  }
}

async function startApi(server: FakeRedisServer) {
  const bus = new EventBus(new FakeRedis(server) as never);
  bus.onModuleInit();
  await new Promise((resolve) => setImmediate(resolve));
  const received: IngestedSignal[] = [];
  bus.ingested$.subscribe((signal) => received.push(signal));
  return { bus, received };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('B가 받은 배치도 A에 붙은 SSE에 알림이 간다', async () => {
  const server = new FakeRedisServer();
  const a = await startApi(server);
  const b = await startApi(server);
  b.bus.emit(30);
  await flush();
  assert.equal(a.received.length, 1);
  assert.equal(a.received[0]!.added, 30);
  assert.equal(b.received.length, 1);
});

test('보낸 쪽에도 한 번만 온다 (두 번 알림 없음)', async () => {
  const server = new FakeRedisServer();
  const a = await startApi(server);
  a.bus.emit(1);
  await flush();
  assert.equal(a.received.length, 1);
});

test('0건은 알리지 않는다', async () => {
  const server = new FakeRedisServer();
  const a = await startApi(server);
  a.bus.emit(0);
  await flush();
  assert.equal(a.received.length, 0);
});

test('Redis가 죽으면 이 API 안에서만 알린다', async () => {
  const server = new FakeRedisServer();
  const a = await startApi(server);
  const b = await startApi(server);
  server.down = true;
  b.bus.emit(5);
  await flush();
  assert.equal(b.received.length, 1);
  assert.equal(a.received.length, 0);
});

test('모양이 다른 메시지는 버린다', async () => {
  const server = new FakeRedisServer();
  const a = await startApi(server);
  await new FakeRedis(server).publish(INGESTED_CHANNEL, 'not-json');
  await new FakeRedis(server).publish(INGESTED_CHANNEL, JSON.stringify({ added: 'x' }));
  await flush();
  assert.equal(a.received.length, 0);
});
