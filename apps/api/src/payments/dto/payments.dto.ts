// DTO = 요청 본문/쿼리의 모양 + 검증 규칙 (프론트의 TS 타입 + zod 스키마). 자세히: docs/architecture.md
import { Type } from 'class-transformer';
import { IsInt, Matches, Max, Min } from 'class-validator';

const ORDER_ID_PATTERN = /^order-[a-z0-9-]{4,40}$/;
/** 헤더라서 DTO 대신 컨트롤러에서 이 패턴으로 검사한다 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export class PayDto {
  @Matches(ORDER_ID_PATTERN)
  orderId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1_000_000)
  amount!: number;
}

export class ListPaymentsDto {
  @Matches(ORDER_ID_PATTERN)
  orderId!: string;
}
