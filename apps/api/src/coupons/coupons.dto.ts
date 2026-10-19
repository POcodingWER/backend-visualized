import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { STRATEGIES, type Strategy } from './coupon-strategies';

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
