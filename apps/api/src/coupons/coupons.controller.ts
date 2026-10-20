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
import { UsageLimitsService } from '../common/rate-limit/usage-limits.service';
import { STRATEGIES, type SimulationResult } from './lib/coupon-strategies';
import { CouponsService } from './coupons.service';
import { IssueDto, ResetDto, SimulateDto, StateQueryDto } from './dto/coupons.dto';

/** Stage 3: 선착순 쿠폰 동시성 데모 (공개 데모: IP별 한도 + 시뮬레이션 단일 실행 + 전역 쿨다운) */
@Controller('coupons')
@UseGuards(ThrottlerGuard)
export class CouponsController {
  /** 시뮬레이션은 DB 커넥션을 많이 쓰므로 동시에 하나만 */
  private running = false;

  constructor(
    private readonly coupons: CouponsService,
    private readonly usageLimits: UsageLimitsService,
  ) {}

  /** 실제 DB 상태 확인: Coupon 행 + CouponIssue 행 수 + 최근 발급 행 (name: demo, sim-none, sim-atomic …) */
  @Get(':name/state')
  async dbState(@Param('name') name: string, @Query() query: StateQueryDto) {
    const couponState = await this.coupons.dbState(name, query.limit ?? 20, query.offset ?? 0);
    if (!couponState) throw new NotFoundException(`coupon '${name}' not found`);
    return couponState;
  }

  @Get('demo')
  demo() {
    return this.coupons.demoState();
  }

  @Post('reset')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 10_000 } })
  reset(@Body() dto: ResetDto) {
    return this.coupons.resetDemo(dto.quantity ?? 100);
  }

  @Post('issue')
  @HttpCode(200)
  async issue(@Body() dto: IssueDto) {
    const result = await this.coupons.issueDemo(dto.strategy, dto.userId);
    if (result === null) throw new NotFoundException('먼저 POST /coupons/reset');
    return result;
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
      const strategiesToRun = dto.strategy ? [dto.strategy] : [...STRATEGIES];
      const results = await this.coupons.simulate(
        strategiesToRun,
        dto.users ?? 500,
        dto.quantity ?? 100,
      );
      return { results };
    } finally {
      this.running = false;
      this.usageLimits.couponSimulationCooldown.restartFromNow();
    }
  }
}
