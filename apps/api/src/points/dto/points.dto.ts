// DTO = 요청 본문/쿼리의 모양 + 검증 규칙 (프론트의 TS 타입 + zod 스키마). 자세히: docs/architecture.md
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SimulatePointsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(400)
  requests?: number;
}

export class EntriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
