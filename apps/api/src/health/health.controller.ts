import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: { status: 'CICD Test', latencyMs: Date.now() - started } };
    } catch (err) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: 'error',
        db: {
          status: 'down',
          error: err instanceof Error ? err.message.split('\n')[0] : String(err),
        },
      };
    }
  }
}
