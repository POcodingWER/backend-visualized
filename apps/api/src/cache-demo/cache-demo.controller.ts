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
import type { Response } from 'express';
import { UsageLimitsService } from '../common/rate-limit/usage-limits.service';
import { CacheDemoService, STAMPEDE_PROTECTIONS } from './cache-demo.service';
import { EditMenuDto, ReadMenuDto, StampedeDto, VisitorsDto } from './dto/cache-demo.dto';

/** 6장 맛집 대기표: 메뉴 읽기(DB 직접 / 대기판 먼저), 메뉴 수정(+DEL), 손님 1000명, 스탬피드 실험 */
@Controller('cache-demo')
@UseGuards(ThrottlerGuard)
export class CacheDemoController {
  private running = false;

  constructor(
    private readonly menu: CacheDemoService,
    private readonly usageLimits: UsageLimitsService,
  ) {}

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
