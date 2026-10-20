// DTO = 요청 본문/쿼리의 모양 + 검증 규칙 (프론트의 TS 타입 + zod 스키마). 자세히: docs/architecture.md
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { STRATEGIES, type Strategy } from '../coupon-strategies';

/** 남용 방지 상한 */
export const MAX_USERS = 1000;
export const MAX_QUANTITY = 500;

export class ResetDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity?: number;
}

export class IssueDto {
  @IsIn(STRATEGIES)
  strategy!: Strategy;

  @IsString()
  @Length(1, 64)
  userId!: string;
}

export class SimulateDto {
  @IsOptional()
  @IsIn(STRATEGIES)
  strategy?: Strategy;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_USERS)
  users?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity?: number;
}

export class StateQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number;
}
