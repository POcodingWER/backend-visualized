import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { IDEMPOTENCY_KEY_PATTERN, ListPaymentsDto, PayDto } from './dto/payments.dto';
import { PaymentsService } from './payments.service';

/** 5장 결제 버튼 두 번: Idempotency-Key 헤더가 있으면 같은 결제를 한 번만 처리한다 */
@Controller('payments')
@UseGuards(ThrottlerGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  async pay(
    @Body() dto: PayDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))
      throw new BadRequestException('Idempotency-Key는 영문·숫자·하이픈 8~64자');
    const outcome = await this.payments.pay(dto.orderId, dto.amount, idempotencyKey);
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
    return this.payments.listByOrder(query.orderId);
  }
}
