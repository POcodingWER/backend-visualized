import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { UsageLimitsService } from '../abuse/usage-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { MenuCache, STAMPEDE_PROTECTIONS, type StampedeProtection } from './menu-cache';
import { RedisService } from './redis.service';

class ReadMenuDto {
  @IsIn(['db', 'cache'])
  via!: 'db' | 'cache';
}

class EditMenuDto {
  @IsBoolean()
  invalidate!: boolean;
}

class VisitorsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(1000)
  visitors?: number;
}

class StampedeDto extends VisitorsDto {
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

/**
 * 6장 맛집 대기표: 진짜 Redis(cache-aside, TTL 5초)와 MySQL.
 * ponytail: single-flight는 이 프로세스 안에서만 묶는다. 서버가 여러 대면 Redis 잠금(SET NX PX)이 필요하다는 게 이 장의 요점.
 */
@Controller('cache-demo')
@UseGuards(ThrottlerGuard)
export class CacheDemoController {
  private readonly menu: MenuCache;
  private running = false;

  constructor(
    prisma: PrismaService,
    redis: RedisService,
    private readonly usageLimits: UsageLimitsService,
  ) {
    this.menu = new MenuCache(prisma, redis);
  }

  @Get('menu')
  read(@Query() query: ReadMenuDto) {
    return query.via === 'db' ? this.menu.readDirect() : this.menu.readThroughCache();
  }

  @Post('menu')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 10_000 } })
  edit(@Body() dto: EditMenuDto) {
    return this.menu.edit(dto.invalidate);
  }

  @Post('visitors')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 10_000 } })
  visitors(@Body() dto: VisitorsDto, @Res({ passthrough: true }) response: Response) {
    return this.exclusive(response, () => this.menu.welcomeVisitors(dto.visitors ?? 1000));
  }

  /** protection 없으면 세 가지를 같은 조건으로 차례로 */
  @Post('stampede')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 10_000 } })
  stampede(@Body() dto: StampedeDto, @Res({ passthrough: true }) response: Response) {
    const protections = dto.protection ? [dto.protection] : [...STAMPEDE_PROTECTIONS];
    return this.exclusive(response, async () => {
      const results = [];
      for (const protection of protections)
        results.push(
          await this.menu.stampede(protection, dto.visitors ?? 1000, dto.instances ?? 3),
        );
      return { results };
    });
  }

  /** 동시에 하나만 + 끝난 뒤 짧은 전역 쿨다운 (DB 커넥션을 많이 쓰므로) */
  private async exclusive<T>(response: Response, work: () => Promise<T>): Promise<T> {
    if (this.running) throw new ConflictException('다른 실험이 실행 중입니다');
    this.usageLimits.enforce(
      this.usageLimits.cacheStampedeCooldown.tryStart(),
      response,
      'simulation_cooldown',
      '방금 실험이 끝났습니다. 잠시 후 다시 실행하세요',
    );
    this.running = true;
    try {
      return await work();
    } finally {
      this.running = false;
      this.usageLimits.cacheStampedeCooldown.restartFromNow();
    }
  }
}
