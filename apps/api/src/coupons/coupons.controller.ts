import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { CouponStrategies, STRATEGIES, type SimulationResult } from './coupon-strategies';
import { IssueDto, ResetDto, SimulateDto } from './coupons.dto';

const DEMO = 'demo';

/** Stage 3: 선착순 쿠폰 동시성 데모 (로컬 데모용, 운영에선 인증 필요) */
@Controller('coupons')
@UseGuards(ThrottlerGuard)
export class CouponsController {
  private readonly s: CouponStrategies;
  /** 시뮬레이션은 DB 커넥션을 많이 쓰므로 동시에 하나만 */
  private running = false;

  constructor(prisma: PrismaService) {
    this.s = new CouponStrategies(prisma);
  }

  @Get('demo')
  async demo() {
    return (
      (await this.s.state(DEMO)) ?? {
        name: DEMO,
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
    await this.s.reset(DEMO, dto.quantity ?? 100);
    return this.s.state(DEMO);
  }

  @Post('issue')
  @HttpCode(200)
  async issue(@Body() dto: IssueDto) {
    const id = await this.s.couponId(DEMO);
    if (id === null) throw new NotFoundException('먼저 POST /coupons/reset');
    return this.s.issue(dto.strategy, id, dto.userId);
  }

  /** strategy 지정 시 하나, 없으면 4개 전략을 순서대로 같은 조건으로 실행 */
  @Post('simulate')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 10_000 } })
  async simulate(@Body() dto: SimulateDto): Promise<{ results: SimulationResult[] }> {
    if (this.running) throw new ConflictException('다른 시뮬레이션이 실행 중입니다');
    this.running = true;
    try {
      const users = dto.users ?? 500;
      const quantity = dto.quantity ?? 100;
      const list = dto.strategy ? [dto.strategy] : [...STRATEGIES];
      const results: SimulationResult[] = [];
      for (const st of list) results.push(await this.s.simulate(st, users, quantity));
      return { results };
    } finally {
      this.running = false;
    }
  }
}
