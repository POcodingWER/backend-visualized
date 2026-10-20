import { Body, Controller, Get, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { UsageLimitsService } from '../common/rate-limit/usage-limits.service';
import { CacheDemoService, STAMPEDE_PROTECTIONS } from './cache-demo.service';
import { EditMenuDto, ReadMenuDto, StampedeDto, VisitorsDto } from './dto/cache-demo.dto';

/** 6장 맛집 대기표: 메뉴 읽기(DB 직접 / 대기판 먼저), 메뉴 수정(+DEL), 손님 1000명, 스탬피드 실험 */
@Controller('cache-demo')
@UseGuards(ThrottlerGuard)
export class CacheDemoController {
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
    return this.usageLimits.runSimulation(this.usageLimits.cacheExperiment, response, () =>
      this.menu.welcomeVisitors(dto.visitors ?? 1000),
    );
  }

  /** protection 없으면 세 가지를 같은 조건으로 차례로 */
  @Post('stampede')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 10_000 } })
  stampede(@Body() dto: StampedeDto, @Res({ passthrough: true }) response: Response) {
    const protections = dto.protection ? [dto.protection] : [...STAMPEDE_PROTECTIONS];
    return this.usageLimits.runSimulation(this.usageLimits.cacheExperiment, response, async () => ({
      results: await this.menu.compareStampedes(
        protections,
        dto.visitors ?? 1000,
        dto.instances ?? 3,
      ),
    }));
  }
}
