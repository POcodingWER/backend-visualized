import 'reflect-metadata';
import { appEnvironment, logEnvironmentSummary } from './common/config/app-environment';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/observability/all-exceptions.filter';
import { REQUEST_ID_HEADER } from './common/observability/request-id';
import { initSentry } from './common/observability/sentry';

async function bootstrap() {
  // bufferLogs: 시작 중 로그도 pino가 준비된 뒤 같은 JSON 모양으로 찍는다
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  logEnvironmentSummary((line) => logger.log(line));
  await initSentry(
    appEnvironment.sentryDsn,
    appEnvironment.isProduction ? 'production' : 'development',
  );
  // 프록시(Caddy/ALB) 뒤에서 req.ip가 실제 클라이언트 IP가 되도록. IP별 레이트 리밋이 이 값을 쓴다
  app.set('trust proxy', appEnvironment.trustProxy);
  app.disable('x-powered-by');
  // 7장 스케일아웃: 어느 인스턴스가 응답했는지 볼 수 있게 (INSTANCE_NAME 환경변수, 컨테이너 ID 노출하지 않음)
  const instanceId = process.env.INSTANCE_NAME ?? 'local';
  app.use(
    (
      _req: unknown,
      res: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader('x-instance-id', instanceId);
      next();
    },
  );
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
  // maxAge: JSON POST마다 붙던 사전 확인(OPTIONS)을 브라우저가 10분 기억 → Network 탭에 요청이 두 번씩 보이지 않게
  // exposedHeaders: 화면(개발자 도구)에서도 x-request-id와 x-instance-id를 읽을 수 있게
  app.enableCors({
    origin: appEnvironment.webOrigins,
    credentials: true,
    maxAge: 600,
    exposedHeaders: [REQUEST_ID_HEADER, 'x-instance-id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // 오류 응답 모양 통일 { statusCode, message, requestId } + 5xx는 로그·Sentry로
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  await app.listen(appEnvironment.port);
  logger.log(`api listening on :${appEnvironment.port}`);
}
void bootstrap();
