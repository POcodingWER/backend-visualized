// DTO = 요청 본문/쿼리의 모양 + 검증 규칙 (프론트의 TS 타입 + zod 스키마). 자세히: docs/architecture.md
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { STAMPEDE_PROTECTIONS, type StampedeProtection } from '../cache-demo.service';

export class ReadMenuDto {
  @IsIn(['db', 'cache'])
  via!: 'db' | 'cache';
}

export class EditMenuDto {
  @IsBoolean()
  invalidate!: boolean;
}

export class VisitorsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(1000)
  visitors?: number;
}

export class StampedeDto extends VisitorsDto {
  @IsOptional()
  @IsIn(STAMPEDE_PROTECTIONS)
  protection?: StampedeProtection;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  instances?: number;
}
