import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { ConfigurationError, loadConfig } from '@offerpath/config';

import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter.js';
import { APP_VERSION } from './version.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  let config;
  try {
    config = loadConfig({ cwd: __dirname });
  } catch (error) {
    // A misconfigured deployment must fail here, loudly and readably, rather
    // than three hours later inside a request.
    if (error instanceof ConfigurationError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });
  const { env } = config;

  app.setGlobalPrefix(`${env.API_GLOBAL_PREFIX}/v1`);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.use(helmet());
  // The web app is served from its own port, so the browser needs CORS.
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  // Synced documents and code submissions are text; 2 MB is generous and caps a trivial DoS.
  app.useBodyParser('json', { limit: '2mb' });

  if (!config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Offerpath API')
        .setDescription('Finds the jobs, gets you ready for the interviews.')
        .setVersion(APP_VERSION)
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(`${env.API_GLOBAL_PREFIX}/docs`, app, document);
  }

  // Graceful shutdown: an in-flight submission must finish writing before exit.
  app.enableShutdownHooks();

  await app.listen(env.OFFERPATH_API_PORT, env.OFFERPATH_HOST);

  logger.log(
    `Offerpath API ${APP_VERSION} on http://${env.OFFERPATH_HOST}:${env.OFFERPATH_API_PORT}/${env.API_GLOBAL_PREFIX}/v1`,
  );
  logger.log(`Execution driver: ${env.EXECUTION_DRIVER}`);
  logger.log('AI: Claude Code on each user’s own desktop, through the hub');
  if (env.OFFERPATH_SIGNUP === 'closed') logger.log('Sign-up is closed');
  if (!env.REDIS_ENABLED) logger.warn('Redis disabled — caching and queues are inactive');
}

void bootstrap();
