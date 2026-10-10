import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import './common/bigint-json'; // P0: BigInt money columns must serialize (idempotent install)
import { healthHandler } from './common/health';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.enableCors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strips unknown fields instead of trusting client payloads verbatim
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api');

  // Audit addition (Step 2): minimal liveness probe. No version, env, or
  // dependency details — it must not leak secrets or internals.
  app.use('/health', healthHandler);
  app.use('/api/health', healthHandler);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
bootstrap();
