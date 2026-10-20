import { Global, Module } from '@nestjs/common';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';
import { UsageLimitsService } from './rate-limit/usage-limits.service';

/** 여러 모듈이 같이 쓰는 것 (전역 한도, 관리자 키 가드). @Global 이라 각 모듈에서 import 하지 않아도 주입된다 */
@Global()
@Module({
  providers: [UsageLimitsService, AdminApiKeyGuard],
  exports: [UsageLimitsService, AdminApiKeyGuard],
})
export class CommonModule {}
