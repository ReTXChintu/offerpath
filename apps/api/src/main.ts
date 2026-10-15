import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@offerpath/config';

import { AppModule } from './app.module';
import { APP_VERSION } from './version';

/** REST lives under this prefix; downloads and updates get their own paths later. */
export const API_PREFIX = 'api/v1';

async function bootstrap(): Promise<void> {
  const env = loadEnv(__dirname);
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(API_PREFIX);
  // The web app is served from its own port, so the browser needs CORS to reach the API.
  app.enableCors({ origin: env.OFFERPATH_CORS_ORIGINS, credentials: true });
  app.enableShutdownHooks();
  await app.listen(env.OFFERPATH_API_PORT, env.OFFERPATH_HOST);
  Logger.log(
    `Offerpath API ${APP_VERSION} on http://${env.OFFERPATH_HOST}:${env.OFFERPATH_API_PORT}/${API_PREFIX}`,
    'Bootstrap',
  );
}

void bootstrap();
