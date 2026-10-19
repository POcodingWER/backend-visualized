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
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { CouponStrategies, STRATEGIES, type SimulationResult } from './coupon-strategies';
import { IssueDto, ResetDto, SimulateDto, StateQueryDto } from './coupons.dto';
import { PrismaClient } from '@prisma/client';
import { OnModuleDestroy } from '@nestjs/common';

const DEMO = 'demo';

/** Stage 3: 선착순 쿠폰 동시성 데모 (로컬 데모용, 운영에선 인증 필요) */
@Controller('coupons')
@UseGuards(ThrottlerGuard)
export class CouponsController implements OnModuleDestroy {
  private readonly s: CouponStrategies;
  /** 시뮬레이션은 DB 커넥션을 많이 쓰므로 동시에 하나만 */
  private running = false;

  /** 시뮬레이션 중 DB 스냅샷 전용 커넥션 1개 (요청들과 풀을 공유하지 않아 대기열에 막히지 않음) */
  private readonly sampler = new PrismaClient({
    datasourceUrl: withConnectionLimit(process.env.DATABASE_URL, 1),
  });

  constructor(prisma: PrismaService) {
    this.s = new CouponStrategies(prisma, this.sampler);
  }

  async onModuleDestroy() {
    await this.sampler.$disconnect();
  }

  /** 실제 DB 상태 확인: Coupon 행 + CouponIssue 행 수 + 최근 발급 행 (name: demo, sim-none, sim-atomic …) */
  @Get(':name/state')
  async dbState(@Param('name') name: string, @Query() q: StateQueryDto) {
    const st = await this.s.dbState(name, q.limit ?? 20, q.offset ?? 0);
    if (!st) throw new NotFoundException(`coupon '${name}' not found`);
    return st;
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

function withConnectionLimit(url: string | undefined, n: number): string | undefined {
  if (!url) return url;
  return url.includes('connection_limit=')
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}connection_limit=${n}`;
}
