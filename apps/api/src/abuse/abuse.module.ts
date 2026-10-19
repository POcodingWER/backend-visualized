import { Global, Module } from '@nestjs/common';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { UsageLimitsService } from './usage-limits.service';

@Global()
@Module({
  providers: [UsageLimitsService, AdminApiKeyGuard],
  exports: [UsageLimitsService, AdminApiKeyGuard],
})
export class AbuseModule {}
