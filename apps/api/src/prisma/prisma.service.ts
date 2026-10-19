import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  // 연결은 첫 쿼리 시 lazy하게 수립 → DB가 꺼져 있어도 서버는 뜨고 /health가 down을 보고
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
