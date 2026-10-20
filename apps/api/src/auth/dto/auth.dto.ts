// DTO = 요청 본문/쿼리의 모양 + 검증 규칙 (프론트의 TS 타입 + zod 스키마). 자세히: docs/architecture.md
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class LoginDto {
  @IsString()
  @Length(1, 50)
  username!: string;

  @IsString()
  @Length(1, 100)
  password!: string;

  /** 데모용: 액세스 토큰 수명을 직접 지정 (5~300초) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(300)
  accessTokenTtlSeconds?: number;
}

export class RefreshDto {
  /** 데모(공격자 시뮬레이션) 전용: 쿠키 대신 본문으로 토큰 제출 */
  @IsOptional()
  @IsString()
  @Length(10, 200)
  refreshToken?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(300)
  accessTokenTtlSeconds?: number;
}
