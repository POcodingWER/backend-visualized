import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { sleep } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';

/** 가짜 결제사(PG) 승인에 걸리는 시간. 이 사이에 두 번째 클릭·재시도가 들어온다 */
export const PAYMENT_GATEWAY_DELAY_MS = 900;
const REPLAY_POLL_MS = 50;
const REPLAY_WAIT_LIMIT_MS = 5_000;
/** 데모 결제 행은 30분 뒤 지운다 */
const KEEP_PAYMENTS_MS = 30 * 60_000;

export interface PaymentView {
  id: number;
  orderId: string;
  amount: number;
  status: string;
  idempotencyKey: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export type PaymentOutcome =
  | { kind: 'charged'; payment: PaymentView }
  /** 같은 키로 이미 결제됨 → 저장해 둔 결과를 그대로 돌려준다 (돈은 다시 안 나감) */
  | { kind: 'replayed'; payment: PaymentView }
  /** 같은 키인데 주문·금액이 다름 → 실수일 가능성이 커서 거절 */
  | { kind: 'key_reused_for_different_request' }
  /** 첫 요청이 아직 끝나지 않음 (오래 걸리거나 중간에 죽음) */
  | { kind: 'still_processing' };

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);
  /** 테스트에서만 짧게 바꾼다 */
  gatewayDelayMs = PAYMENT_GATEWAY_DELAY_MS;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async deleteOldDemoPayments() {
    const { count } = await this.deleteOlderThan(new Date(Date.now() - KEEP_PAYMENTS_MS));
    if (count > 0) this.log.log(`old demo payments deleted (${count})`);
  }

  /**
   * 결제 요청 하나. 키가 있으면 먼저 'processing' 행을 키와 함께 INSERT 해서 자리를 잡는다.
   * 동시에 같은 키가 두 개 와도 unique 제약 때문에 INSERT는 하나만 성공한다 (애플리케이션 if문이 아니라 DB가 막음).
   * ponytail: 첫 요청이 PG 호출 중에 죽으면 그 키는 processing으로 남는다. 운영에선 오래된 processing을 PG에 조회해 정리하는 잡이 필요.
   */
  async pay(orderId: string, amount: number, idempotencyKey?: string): Promise<PaymentOutcome> {
    let reserved: PaymentView;
    try {
      reserved = await this.prisma.payment.create({
        data: { orderId, amount, status: 'processing', idempotencyKey: idempotencyKey ?? null },
      });
    } catch (error) {
      if (idempotencyKey && isUniqueViolation(error))
        return this.waitForStoredResult(idempotencyKey, orderId, amount);
      throw error;
    }
    await sleep(this.gatewayDelayMs); // PG 승인 대기 (가짜)
    const payment = await this.prisma.payment.update({
      where: { id: reserved.id },
      data: { status: 'paid', paidAt: new Date() },
    });
    return { kind: 'charged', payment };
  }

  private async waitForStoredResult(
    idempotencyKey: string,
    orderId: string,
    amount: number,
  ): Promise<PaymentOutcome> {
    const giveUpAt = Date.now() + REPLAY_WAIT_LIMIT_MS;
    for (;;) {
      const stored = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
      if (stored && (stored.orderId !== orderId || stored.amount !== amount))
        return { kind: 'key_reused_for_different_request' };
      if (stored?.status === 'paid') return { kind: 'replayed', payment: stored };
      if (Date.now() > giveUpAt) return { kind: 'still_processing' };
      await sleep(REPLAY_POLL_MS);
    }
  }

  listByOrder(orderId: string) {
    return this.prisma.payment.findMany({ where: { orderId }, orderBy: { id: 'asc' }, take: 50 });
  }

  deleteOlderThan(cutoff: Date) {
    return this.prisma.payment.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
