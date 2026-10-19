import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { UsageLimitsService } from '../abuse/usage-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { CouponStrategies, STRATEGIES, type SimulationResult } from './coupon-strategies';
import { IssueDto, ResetDto, SimulateDto, StateQueryDto } from './coupons.dto';
import { PrismaClient } from '@prisma/client';
import { OnModuleDestroy } from '@nestjs/common';

const DEMO_COUPON_NAME = 'demo';

/** Stage 3: 선착순 쿠폰 동시성 데모 (공개 데모: IP별 한도 + 시뮬레이션 단일 실행 + 전역 쿨다운) */
@Controller('coupons')
@UseGuards(ThrottlerGuard)
export class CouponsController implements OnModuleDestroy {
  private readonly strategies: CouponStrategies;
  /** 시뮬레이션은 DB 커넥션을 많이 쓰므로 동시에 하나만 */
  private running = false;

  /** 시뮬레이션 중 DB 스냅샷 전용 커넥션 1개 (요청들과 풀을 공유하지 않아 대기열에 막히지 않음) */
  private readonly sampler = new PrismaClient({
    datasourceUrl: withConnectionLimit(process.env.DATABASE_URL, 1),
  });

  constructor(
    prisma: PrismaService,
    private readonly usageLimits: UsageLimitsService,
  ) {
    this.strategies = new CouponStrategies(prisma, this.sampler);
  }

  async onModuleDestroy() {
    await this.sampler.$disconnect();
  }

  /** 실제 DB 상태 확인: Coupon 행 + CouponIssue 행 수 + 최근 발급 행 (name: demo, sim-none, sim-atomic …) */
  @Get(':name/state')
  async dbState(@Param('name') name: string, @Query() query: StateQueryDto) {
    const couponState = await this.strategies.dbState(name, query.limit ?? 20, query.offset ?? 0);
    if (!couponState) throw new NotFoundException(`coupon '${name}' not found`);
    return couponState;
  }

  @Get('demo')
  async demo() {
    return (
      (await this.strategies.state(DEMO_COUPON_NAME)) ?? {
        name: DEMO_COUPON_NAME,
        totalQuantity: 0,
        counter: 0,
        issued: 0,
        oversold: 0,
      }
    );
  }

  @Post('reset')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 10_000 } })
  async reset(@Body() dto: ResetDto) {
    await this.strategies.reset(DEMO_COUPON_NAME, dto.quantity ?? 100);
    return this.strategies.state(DEMO_COUPON_NAME);
  }

  @Post('issue')
  @HttpCode(200)
  async issue(@Body() dto: IssueDto) {
    const couponId = await this.strategies.couponId(DEMO_COUPON_NAME);
    if (couponId === null) throw new NotFoundException('먼저 POST /coupons/reset');
    return this.strategies.issue(dto.strategy, couponId, dto.userId);
  }

  /** strategy 지정 시 하나, 없으면 4개 전략을 순서대로 같은 조건으로 실행 */
  @Post('simulate')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 10_000 } })
  async simulate(
    @Body() dto: SimulateDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ results: SimulationResult[] }> {
    if (this.running) throw new ConflictException('다른 시뮬레이션이 실행 중입니다');
    // 전역 쿨다운: 시뮬레이션은 DB 커넥션을 많이 쓰므로 끝난 뒤에도 잠깐 쉬게 한다
    this.usageLimits.enforce(
      this.usageLimits.couponSimulationCooldown.tryStart(),
      response,
      'simulation_cooldown',
      '방금 시뮬레이션이 끝났습니다. 잠시 후 다시 실행하세요',
    );
    this.running = true;
    try {
      const users = dto.users ?? 500;
      const quantity = dto.quantity ?? 100;
      const strategiesToRun = dto.strategy ? [dto.strategy] : [...STRATEGIES];
      const results: SimulationResult[] = [];
      for (const strategyName of strategiesToRun)
        results.push(await this.strategies.simulate(strategyName, users, quantity));
      return { results };
    } finally {
      this.running = false;
      this.usageLimits.couponSimulationCooldown.restartFromNow();
    }
  }
}

function withConnectionLimit(url: string | undefined, limit: number): string | undefined {
  if (!url) return url;
  return url.includes('connection_limit=')
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}connection_limit=${limit}`;
}
