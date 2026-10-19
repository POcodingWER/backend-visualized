import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const MAX_BATCH_SIZE = 100;

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sessionId!: string;

  /** 클라이언트 발생 시각 (SDK가 전송, 현재는 참고용 — 저장 시각은 서버 기준) */
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

export class BatchEventsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => CreateEventDto)
  events!: CreateEventDto[];
}

export class StatsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
