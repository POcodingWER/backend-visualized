import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { UsageLimitsService } from '../common/rate-limit/usage-limits.service';
import { EntriesParamsDto, EntriesQueryDto, SimulatePointsDto } from './dto/points.dto';
import { PointsService } from './points.service';

/** 4장 포인트 통장: 같은 적립/사용 요청을 두 방식으로 동시에 보내고 잔액과 내역 합계를 맞춰 본다 */
@Controller('points')
@UseGuards(ThrottlerGuard)
export class PointsController {
  constructor(
    private readonly points: PointsService,
    private readonly usageLimits: UsageLimitsService,
  ) {}

  @Post('simulate')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 10_000 } })
  simulate(@Body() dto: SimulatePointsDto, @Res({ passthrough: true }) response: Response) {
    return this.usageLimits.runSimulation(this.usageLimits.pointSimulation, response, async () => ({
      results: await this.points.simulateBothModes(dto.requests ?? 200),
    }));
  }

  /** 개발자용: 지갑 잔액 칸, 내역 합계, 최근 내역 행 */
  @Get(':mode/entries')
  entries(@Param() params: EntriesParamsDto, @Query() query: EntriesQueryDto) {
    return this.points.entriesFor(params.mode, query.limit ?? 12);
  }
}
