import {
  BadRequestException,
  Body,
  ConflictException,
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
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { UsageLimitsService } from '../abuse/usage-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { PointLedger, POINT_MODES, type PointMode } from './point-ledger';

const WALLET_BY_MODE: Record<PointMode, string> = {
  overwrite: 'sim-overwrite',
  ledger: 'sim-ledger',
};

class SimulatePointsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(400)
  requests?: number;
}

class EntriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/** 4장 포인트 통장: 같은 적립/사용 요청을 두 방식으로 동시에 보내고 잔액과 내역 합계를 맞춰 본다 */
@Controller('points')
@UseGuards(ThrottlerGuard)
export class PointsController {
  private readonly ledger: PointLedger;
  private running = false;

  constructor(
    prisma: PrismaService,
    private readonly usageLimits: UsageLimitsService,
  ) {
    this.ledger = new PointLedger(prisma);
  }

  @Post('simulate')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 10_000 } })
  async simulate(@Body() dto: SimulatePointsDto, @Res({ passthrough: true }) response: Response) {
    if (this.running) throw new ConflictException('다른 시뮬레이션이 실행 중입니다');
    this.usageLimits.enforce(
      this.usageLimits.pointSimulationCooldown.tryStart(),
      response,
      'simulation_cooldown',
      '방금 시뮬레이션이 끝났습니다. 잠시 후 다시 실행하세요',
    );
    this.running = true;
    try {
      const requests = dto.requests ?? 200;
      const results = [];
      for (const mode of POINT_MODES)
        results.push(await this.ledger.simulate(mode, WALLET_BY_MODE[mode], requests));
      return { results };
    } finally {
      this.running = false;
      this.usageLimits.pointSimulationCooldown.restartFromNow();
    }
  }

  /** 개발자용: 지갑 잔액 칸, 내역 합계, 최근 내역 행 */
  @Get(':mode/entries')
  async entries(@Param('mode') mode: string, @Query() query: EntriesQueryDto) {
    if (!(POINT_MODES as readonly string[]).includes(mode))
      throw new BadRequestException(`mode는 ${POINT_MODES.join(', ')} 중 하나`);
    const walletName = WALLET_BY_MODE[mode as PointMode];
    const [reconciliation, entries] = await Promise.all([
      this.ledger.reconcile(walletName).catch(() => null),
      this.ledger.recentEntries(walletName, query.limit ?? 12),
    ]);
    return {
      walletName,
      reconciliation,
      entries: entries.map((entry) => ({ ...entry, id: entry.id.toString() })),
    };
  }
}
