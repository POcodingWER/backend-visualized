import 'reflect-metadata';
import { appEnvironment, logEnvironmentSummary } from './common/config/app-environment';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  logEnvironmentSummary();
  // 프록시(Caddy/ALB) 뒤에서 req.ip가 실제 클라이언트 IP가 되도록. IP별 레이트 리밋이 이 값을 쓴다
  app.set('trust proxy', appEnvironment.trustProxy);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: appEnvironment.maxBodySize });
  // navigator.sendBeacon은 CORS preflight를 피하려고 text/plain으로 보냄 → JSON으로 파싱
  app.useBodyParser('text', { type: 'text/plain', limit: appEnvironment.maxBodySize });
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
  // credentials: 리프레시 토큰 httpOnly 쿠키를 주고받기 위해 필요 (그래서 정확한 출처 목록만 허용)
  app.enableCors({ origin: appEnvironment.webOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  await app.listen(appEnvironment.port);
  console.log(`api listening on :${appEnvironment.port}`);
}
void bootstrap();
