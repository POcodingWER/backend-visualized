import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { AdminApiKeyGuard } from '../abuse/admin-api-key.guard';
import { AggregationService } from './aggregation.service';
import { StatsQueryDto } from './create-event.dto';

/**
 * 관리자용 수동 집계 (임의 기간 지정 가능). X-Admin-Api-Key 헤더 필요.
 * 브라우저 데모 버튼은 비밀값 없이 POST /demo/aggregate (전역 쿨다운) 를 쓴다.
 */
@Controller('admin')
@UseGuards(AdminApiKeyGuard)
export class AdminController {
  constructor(private readonly aggregation: AggregationService) {}

  @Post('aggregate')
  aggregate(@Query() query: StatsQueryDto) {
    return this.aggregation.aggregateRange(query.from, query.to);
  }
}
