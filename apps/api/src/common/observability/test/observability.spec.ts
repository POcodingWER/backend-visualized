import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AllExceptionsFilter, toErrorBody } from '../all-exceptions.filter';
import { assignRequestId } from '../logger';
import { pickRequestId, REQUEST_ID_HEADER } from '../request-id';

test('request id: 안전한 값은 그대로, 없거나 이상하면 새로 만든다', () => {
  assert.equal(pickRequestId('abc-123_x.y'), 'abc-123_x.y');
  assert.equal(pickRequestId(['first', 'second']), 'first');
  assert.match(pickRequestId(undefined), /^[0-9a-f-]{36}$/);
  assert.match(pickRequestId('bad value\nwith newline'), /^[0-9a-f-]{36}$/);
  assert.match(pickRequestId('x'.repeat(65)), /^[0-9a-f-]{36}$/);
});

test('request id: 들어온 번호를 응답 헤더로 그대로 돌려준다', () => {
  const headers: Record<string, string> = {};
  const response = { setHeader: (name: string, value: string) => (headers[name] = value) };
  const id = assignRequestId(
    { headers: { [REQUEST_ID_HEADER]: 'from-client-1' } } as never,
    response as never,
  );
  assert.equal(id, 'from-client-1');
  assert.equal(headers[REQUEST_ID_HEADER], 'from-client-1');
});

test('오류 모양: HttpException은 원래 값(이유 코드 등)을 지키고 requestId를 붙인다', () => {
  const body = toErrorBody(
    new ServiceUnavailableException({
      statusCode: 503,
      reason: 'too_many_stream_connections',
      message: '한도',
    }),
    'r1',
  );
  assert.deepEqual(body, {
    statusCode: 503,
    reason: 'too_many_stream_connections',
    message: '한도',
    requestId: 'r1',
  });
  assert.deepEqual(toErrorBody(new BadRequestException('잘못된 값'), 'r2').message, '잘못된 값');
});

test('오류 모양: 예상 못 한 오류는 500 + 짧은 문장만 (스택·내부 메시지 없음)', () => {
  const body = toErrorBody(new Error('SELECT * FROM secret failed'), 'r3');
  assert.deepEqual(body, { statusCode: 500, message: 'Internal server error', requestId: 'r3' });
  assert.ok(!JSON.stringify(body).includes('secret'));
});

test('filter: 요청 번호를 꺼내 응답으로 보내고, 이미 보낸 응답은 건드리지 않는다', () => {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    headersSent: false,
    getHeader: () => undefined,
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ id: 'req-9' }), getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(new BadRequestException('x'), host);
  assert.equal(sent.status, 400);
  assert.equal((sent.body as { requestId: string }).requestId, 'req-9');

  response.headersSent = true;
  sent.status = undefined;
  new AllExceptionsFilter().catch(new BadRequestException('y'), host);
  assert.equal(sent.status, undefined);
});
