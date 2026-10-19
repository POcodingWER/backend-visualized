import { Controller, Post, Query } from '@nestjs/common';
import { AggregationService } from './aggregation.service';
import { StatsQueryDto } from './create-event.dto';

/** 로컬 테스트용 수동 집계 트리거 (운영에선 인증 필요) */
@Controller('admin')
export class AdminController {
  constructor(private readonly agg: AggregationService) {}

  @Post('aggregate')
  aggregate(@Query() q: StatsQueryDto) {
    return this.agg.aggregateRange(q.from, q.to);
  }
}
