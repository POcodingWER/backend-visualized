import { callApi } from '../../lib/api';

/** instance: 응답 헤더 x-instance-id. 요청이 실패하면 null */
export interface Answer {
  instance: string | null;
}

/** /health를 동시에 count번 불러, 어느 API 인스턴스가 받았는지 순서대로 돌려준다 */
export async function askWhoAnswered(count: number): Promise<Answer[]> {
  return Promise.all(
    Array.from({ length: count }, async () => {
      try {
        const result = await callApi('/health');
        return { instance: result.ok ? (result.instanceId ?? 'local') : null };
      } catch {
        return { instance: null };
      }
    }),
  );
}
