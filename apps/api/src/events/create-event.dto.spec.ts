import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BatchEventsDto, MAX_BATCH_SIZE } from './create-event.dto';

const ev = (i = 0) => ({ name: 'click', sessionId: `s${i}`, properties: { i } });
const check = async (body: unknown) =>
  validate(plainToInstance(BatchEventsDto, body), { whitelist: true, forbidNonWhitelisted: true });

test('valid batch passes', async () => {
  assert.equal((await check({ events: [ev(1), ev(2)] })).length, 0);
});

test('empty batch rejected', async () => {
  assert.ok((await check({ events: [] })).length > 0);
});

test(`more than ${MAX_BATCH_SIZE} events rejected`, async () => {
  const events = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ev(i));
  assert.ok((await check({ events })).length > 0);
  assert.equal((await check({ events: events.slice(0, MAX_BATCH_SIZE) })).length, 0);
});

test('nested event validation (missing sessionId, unknown field)', async () => {
  const errs = await check({ events: [ev(1), { name: 'x' }] });
  assert.ok(errs.length > 0);
  assert.ok((await check({ events: [{ ...ev(1), hacker: true }] })).length > 0);
});

test('events must be an array', async () => {
  assert.ok((await check({ events: 'nope' })).length > 0);
  assert.ok((await check({})).length > 0);
});
