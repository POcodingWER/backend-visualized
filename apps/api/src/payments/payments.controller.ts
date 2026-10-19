import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Logger,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsInt, Matches, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentDesk } from './payment-desk';

const ORDER_ID_PATTERN = /^order-[a-z0-9-]{4,40}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
/** 데모 결제 행은 30분 뒤 지운다 */
const KEEP_PAYMENTS_MS = 30 * 60_000;

class PayDto {
  @Matches(ORDER_ID_PATTERN)
  orderId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1_000_000)
  amount!: number;
}

class ListPaymentsDto {
  @Matches(ORDER_ID_PATTERN)
  orderId!: string;
}

/** 5장 결제 버튼 두 번: Idempotency-Key 헤더가 있으면 같은 결제를 한 번만 처리한다 */
@Controller('payments')
@UseGuards(ThrottlerGuard)
export class PaymentsController {
  private readonly log = new Logger(PaymentsController.name);
  private readonly desk: PaymentDesk;

  constructor(prisma: PrismaService) {
    this.desk = new PaymentDesk(prisma);
  }

  @Post()
  async pay(
    @Body() dto: PayDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))
      throw new BadRequestException('Idempotency-Key는 영문·숫자·하이픈 8~64자');
    const outcome = await this.desk.pay(dto.orderId, dto.amount, idempotencyKey);
    if (outcome.kind === 'key_reused_for_different_request')
      throw new UnprocessableEntityException('같은 Idempotency-Key로 다른 결제를 보냈습니다');
    if (outcome.kind === 'still_processing')
      throw new ConflictException('같은 키의 첫 결제가 아직 처리 중입니다');
    // 재전송이어도 첫 응답과 같은 본문·상태코드. 재생 여부만 헤더로 알려준다
    if (outcome.kind === 'replayed') response.setHeader('Idempotent-Replayed', 'true');
    return { payment: outcome.payment, replayed: outcome.kind === 'replayed' };
  }

  /** 결제 테이블 실시간 보기 (주문 하나의 행들) */
  @Get()
  list(@Query() query: ListPaymentsDto) {
    return this.desk.listByOrder(query.orderId);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async deleteOldDemoPayments() {
    const { count } = await this.desk.deleteOlderThan(new Date(Date.now() - KEEP_PAYMENTS_MS));
    if (count > 0) this.log.log(`old demo payments deleted (${count})`);
  }
}
