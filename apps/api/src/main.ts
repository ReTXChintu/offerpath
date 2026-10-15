import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@offerpath/config';

import { AppModule } from './app.module';
import { APP_VERSION } from './version';

/** Everything public lives under this prefix; `/` is left for the web app. */
export const API_PREFIX = 'api/v1';

async function bootstrap(): Promise<void> {
  const env = loadEnv(__dirname);
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  await app.listen(env.OFFERPATH_PORT, env.OFFERPATH_HOST);
  Logger.log(
    `Offerpath API ${APP_VERSION} on http://${env.OFFERPATH_HOST}:${env.OFFERPATH_PORT}/${API_PREFIX}`,
    'Bootstrap',
  );
}

void bootstrap();
