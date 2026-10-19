import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '1mb' });
  // navigator.sendBeacon은 CORS preflight를 피하려고 text/plain으로 보냄 → JSON으로 파싱
  app.useBodyParser('text', { type: 'text/plain', limit: '1mb' });
  app.use((req: { body?: unknown }, _res: unknown, next: () => void) => {
    if (typeof req.body === 'string' && req.body.length > 0) {
      try {
        req.body = JSON.parse(req.body) as unknown;
      } catch {
        // 그대로 두면 ValidationPipe가 400 처리
      }
    }
    next();
  });
  const origin = process.env.WEB_ORIGIN ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({ origin: origin.split(',').map((s) => s.trim()) });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`api listening on :${port}`);
}
void bootstrap();
