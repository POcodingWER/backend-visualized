import { callApi, FriendlyError, requireOk } from '../../lib/api';

/** 6장 맛집 대기표 API (cache-demo 모듈 + Redis) */

export type Node = 'api' | 'redis' | 'db';
export interface Hop {
  from: Node;
  to: Node;
  label: string;
}
export interface MenuRead {
  board: { content: string; version: number };
  source: 'db' | 'cache';
  hops: Hop[];
  ttlLeftMs: number | null;
}
export interface VisitorsResult {
  direct: { visitors: number; dbReads: number; ms: number };
  cached: { visitors: number; dbReads: number; ms: number };
}
export type Protection = 'none' | 'single-flight' | 'redis-lock';
export type VisitorPath = 'cache' | 'db' | 'waited' | 'db-fallback';
export type RedisCommandName = 'GET' | 'SET EX' | 'SET NX' | 'DEL';
export interface StampedeResult {
  protection: Protection;
  visitors: number;
  instances: number;
  durationMs: number;
  dbReads: number;
  commands: Record<RedisCommandName, number>;
  traces?: { instance: number; startedAtMs: number; finishedAtMs: number; path: VisitorPath }[];
}

/** 시뮬레이션은 한 번에 하나 + 쿨다운이라 409/429는 "누가 방금 돌렸다"로 안내한다 */
async function runExperiment<Body>(path: string, json: unknown): Promise<Body> {
  const response = await callApi<Body>(path, { json });
  if (response.status === 429 || response.status === 409)
    throw new FriendlyError('방금 누가 실행했어요. 몇 초 뒤에 다시 눌러 주세요.');
  if (!response.ok)
    throw new FriendlyError(`서버 오류 (${response.status}). Redis가 켜져 있는지 확인해 주세요.`);
  return response.body;
}

export const readMenu = (via: 'db' | 'cache') =>
  requireOk<MenuRead>(callApi(`/cache-demo/menu?via=${via}`));

export const editMenu = (invalidate: boolean) =>
  runExperiment<{ board: { version: number }; hops: Hop[] }>('/cache-demo/menu', { invalidate });

export const runVisitors = (visitors: number) =>
  runExperiment<VisitorsResult>('/cache-demo/visitors', { visitors });

export const runStampede = async (visitors: number, instances: number) =>
  (
    await runExperiment<{ results: StampedeResult[] }>('/cache-demo/stampede', {
      visitors,
      instances,
    })
  ).results;
