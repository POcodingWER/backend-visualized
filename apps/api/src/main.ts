import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origin = process.env.WEB_ORIGIN ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({ origin: origin.split(',').map((s) => s.trim()) });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`api listening on :${port}`);
}
void bootstrap();
