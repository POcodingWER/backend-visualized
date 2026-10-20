import { callApi, requireOk } from '../../lib/api';

/** 5장 결제 버튼 두 번 API (payments 모듈) */

export interface PaymentRow {
  id: number;
  orderId: string;
  amount: number;
  status: string;
  idempotencyKey: string | null;
  createdAt: string;
  paidAt: string | null;
}

/**
 * 결제 요청 한 번. idempotencyKey를 주면 Idempotency-Key 헤더로 보낸다 (같은 키 = 같은 결제).
 * replayed=true면 서버가 새로 결제하지 않고 처음 결과를 다시 돌려준 것.
 */
export const pay = ({
  orderId,
  amount,
  idempotencyKey,
  signal,
}: {
  orderId: string;
  amount: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
}) =>
  requireOk<{ payment: PaymentRow; replayed: boolean }>(
    callApi('/payments', {
      json: { orderId, amount },
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      signal,
    }),
  );

/** 이 주문으로 실제 생긴 결제 행들 */
export const listPayments = (orderId: string) =>
  requireOk<PaymentRow[]>(callApi(`/payments?orderId=${encodeURIComponent(orderId)}`));
