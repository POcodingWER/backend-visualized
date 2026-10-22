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
/**
 * processing으로 이만큼 남아 있으면 "첫 요청이 PG 호출 중에 죽었다"고 본다.
 * 정상이면 PG 대기(0.9초) + 재전송 대기 한도(5초) 안에 끝나므로 5분은 넉넉하다.
 * 배포 때 예전 색이 멈추기 전 처리 중이던 요청(drain 10초)도 이 안에 끝난다.
 */
export const STALE_PROCESSING_MS = 5 * 60_000;

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
  /** 첫 요청이 중간에 죽어서 정리 잡이 실패로 닫았음 → 돈은 안 나갔으니 새 키로 다시 */
  | { kind: 'previous_attempt_failed' }
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

  /**
   * 10분마다 30분 지난 데모 결제 삭제. 7장: 인스턴스 2개라 10분마다 2번 돌지만,
   * DELETE ... WHERE createdAt < 기준이라 동시 실행해도 각자 지울 행만 지우고 중복 삭제는 없음.
   * 데모 정리 작업이라 중복 실행이 문제가 아님 (이벤트 집계와 달리 DB 비용 미미).
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async deleteOldDemoPayments() {
    const { count } = await this.deleteOlderThan(new Date(Date.now() - KEEP_PAYMENTS_MS));
    if (count > 0) this.log.log(`old demo payments deleted (${count})`);
  }

  /**
   * 매분: 오래 processing으로 남은 결제를 PG에 물어보고 정리한다.
   * 7장: 인스턴스가 2개라 매분 2번 돌지만, 조건부 UPDATE (WHERE status='processing' AND ...)라
   * 동시 실행해도 한 행은 한 번만 바뀌므로 안전 → 별도 락 불필요. 이벤트 집계와 달리 멱등 작업이라
   * 중복 실행이 큰 비용이 아니고, 5분 + 재시도 안에 끝나는 마이그레이션도 Prisma advisory lock으로
   * 하나만 실제 실행되므로 이 cron도 추가 동기화 없이 유지.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async closeStalePayments() {
    const count = await this.failStaleProcessing(new Date(Date.now() - STALE_PROCESSING_MS));
    if (count > 0) this.log.warn(`stale processing payments marked failed (${count})`);
  }

  /**
   * 가짜 PG에는 "승인 기록"이 없다 = 승인 전에 죽은 것 → 돈이 안 나갔으니 failed로 닫는다.
   * 진짜 PG라면 여기서 결제사 조회 API로 승인 여부를 묻고, 승인됐으면 paid로 바꿔야 한다.
   *
   * UPDATE … WHERE status='processing' AND createdAt < 기준 한 문장이라, 여러 인스턴스가
   * 같은 순간에 돌아도 한 행은 한 번만 바뀐다 (두 번째 UPDATE는 조건에 안 맞아 0행).
   * 그 사이 첫 요청이 늦게 살아나 paid로 바꾸려 해도, pay()의 UPDATE도 status='processing' 조건이라 덮어쓰지 않는다.
   */
  async failStaleProcessing(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.payment.updateMany({
      where: { status: 'processing', createdAt: { lt: cutoff } },
      data: { status: 'failed' },
    });
    return count;
  }

  /**
   * 결제 요청 하나. 키가 있으면 먼저 'processing' 행을 키와 함께 INSERT 해서 자리를 잡는다.
   * 동시에 같은 키가 두 개 와도 unique 제약 때문에 INSERT는 하나만 성공한다 (애플리케이션 if문이 아니라 DB가 막음).
   * 첫 요청이 PG 호출 중에 죽어 processing으로 남은 행은 closeStalePayments가 5분 뒤 failed로 닫는다.
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
    // processing일 때만 paid로: 정리 잡이 이미 failed로 닫았으면 덮어쓰지 않는다
    const { count } = await this.prisma.payment.updateMany({
      where: { id: reserved.id, status: 'processing' },
      data: { status: 'paid', paidAt: new Date() },
    });
    if (count === 0) return { kind: 'previous_attempt_failed' };
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: reserved.id } });
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
      if (stored?.status === 'failed') return { kind: 'previous_attempt_failed' };
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
