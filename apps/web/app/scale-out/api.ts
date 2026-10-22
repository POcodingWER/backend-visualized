import { callApi } from '../../lib/api';

export interface HealthCheckResult {
  status: string;
  instance: string;
  timestamp: string;
}

export async function apiHealthCheck(): Promise<HealthCheckResult> {
  const result = await callApi<{ status: string }>('/health', {
    method: 'GET',
  });

  if (!result.ok) {
    throw new Error('Health check 실패');
  }

  return {
    status: result.body.status,
    instance: result.instanceId || 'unknown',
    timestamp: new Date().toISOString(),
  };
}
