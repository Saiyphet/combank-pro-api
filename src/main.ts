import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // อยู่หลัง ingress / reverse proxy: ใช้ IP จริงของผู้ใช้จาก X-Forwarded-For
  // ไม่ตั้ง = ทุกคนจะได้ IP ของ ingress แล้วใช้โควตา login ร่วมกัน
  // ตั้งเป็นจำนวน proxy ที่อยู่หน้า app (เช่น 1) — อย่าตั้ง true
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

  app.disable('x-powered-by');
  app.setGlobalPrefix('api');

  const origins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins && origins.length ? origins : true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`lucky-draw-api listening on :${port}`);
}

bootstrap();