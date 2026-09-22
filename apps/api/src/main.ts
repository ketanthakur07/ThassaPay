import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

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

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
bootstrap();
