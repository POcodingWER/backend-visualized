import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CouponStrategies, type SimulationResult, type Strategy } from './lib/coupon-strategies';

const DEMO_COUPON_NAME = 'demo';

/**
 * 3장 선착순 쿠폰: 화면의 '데모 쿠폰'과 시뮬레이션을 발급 전략 4종(coupon-strategies.ts)에 연결한다.
 * 전략 파일은 Nest 없이 PrismaClient만 받아서 테스트·벤치(scripts/bench-coupon.ts)도 그대로 쓴다.
 */
@Injectable()
export class CouponsService implements OnModuleDestroy {
  /** 시뮬레이션 중 DB 스냅샷 전용 커넥션 1개 (요청들과 풀을 공유하지 않아 대기열에 막히지 않음) */
  private readonly sampler = new PrismaClient({
    datasourceUrl: withConnectionLimit(process.env.DATABASE_URL, 1),
  });
  private readonly strategies: CouponStrategies;

  constructor(prisma: PrismaService) {
    this.strategies = new CouponStrategies(prisma, this.sampler);
  }

  async onModuleDestroy() {
    await this.sampler.$disconnect();
  }

  /** 실제 DB 상태: Coupon 행 + CouponIssue 행 수 + 최근 발급 행. 없는 쿠폰이면 null */
  dbState(name: string, limit: number, offset: number) {
    return this.strategies.dbState(name, limit, offset);
  }

  async demoState() {
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

  async resetDemo(quantity: number) {
    await this.strategies.reset(DEMO_COUPON_NAME, quantity);
    return this.strategies.state(DEMO_COUPON_NAME);
  }

  /** 데모 쿠폰이 아직 없으면 null */
  async issueDemo(strategy: Strategy, userId: string) {
    const couponId = await this.strategies.couponId(DEMO_COUPON_NAME);
    if (couponId === null) return null;
    return this.strategies.issue(strategy, couponId, userId);
  }

  /** 여러 전략을 같은 조건으로 차례로 (동시에 돌리면 서로의 DB 부하가 섞인다) */
  async simulate(strategies: Strategy[], users: number, quantity: number) {
    const results: SimulationResult[] = [];
    for (const strategyName of strategies)
      results.push(await this.strategies.simulate(strategyName, users, quantity));
    return results;
  }
}

function withConnectionLimit(url: string | undefined, limit: number): string | undefined {
  if (!url) return url;
  return url.includes('connection_limit=')
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}connection_limit=${limit}`;
}
