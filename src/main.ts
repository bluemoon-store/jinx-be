import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { useContainer } from 'class-validator';
import compression from 'compression';
import express from 'express';
import { Logger } from 'nestjs-pino';
import { getQueueToken } from '@nestjs/bull';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter as BullBoardExpressAdapter } from '@bull-board/express';

import { CorsIoAdapter } from './common/adapters/socket-io.adapter';
import { AppModule } from './app/app.module';
import { WorkerAppModule } from './app/worker.module';
import { APP_ENVIRONMENT, APP_BULL_QUEUES } from './app/enums/app.enum';
import setupSwagger from './swagger';

const APP_ROLE = (process.env.APP_ROLE || 'api').toLowerCase();

async function bootstrapApi(): Promise<void> {
    const server = express();
    let app: any;

    try {
        app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
            bufferLogs: true,
            // Capture the raw request body so payment webhooks can verify
            // HMAC signatures (see FiatPaymentWebhookController).
            rawBody: true,
        });

        const config = app.get(ConfigService);
        const logger = app.get(Logger);
        const env = config.get('app.env');
        const host = config.getOrThrow('app.http.host');
        const port = config.getOrThrow('app.http.port');

        // Bull Board - Queue dashboard
        const serverAdapter = new BullBoardExpressAdapter();
        serverAdapter.setBasePath('/admin/queues');

        const queues = [
            app.get(getQueueToken('crypto-payment-verification')),
            app.get(getQueueToken('crypto-payment-forwarding')),
            app.get(getQueueToken('fiat-payment')),
            app.get(getQueueToken(APP_BULL_QUEUES.EMAIL)),
            app.get(getQueueToken(APP_BULL_QUEUES.NOTIFICATION)),
            app.get(getQueueToken(APP_BULL_QUEUES.ACTIVITY_LOG)),
        ];

        createBullBoard({
            queues: queues.map(queue => new BullAdapter(queue)),
            serverAdapter,
        });

        app.use('/admin/queues', serverAdapter.getRouter());
        logger.log('Bull Board available at /admin/queues');

        app.use(compression());
        app.useLogger(logger);
        app.enableCors(config.get('app.cors'));

        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                whitelist: true,
                forbidNonWhitelisted: true,
            })
        );

        app.useWebSocketAdapter(new CorsIoAdapter(app, config.get('app.cors')));

        app.enableVersioning({
            type: VersioningType.URI,
            defaultVersion: '1',
        });

        useContainer(app.select(AppModule), { fallbackOnErrors: true });

        if (env !== APP_ENVIRONMENT.PRODUCTION) {
            setupSwagger(app);
        }

        if (env === APP_ENVIRONMENT.PRODUCTION) {
            const gracefulShutdown = async (signal: string) => {
                logger.log(`Received ${signal}, shutting down gracefully...`);
                await app.close();
                process.exit(0);
            };

            process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
            process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        } else {
            app.enableShutdownHooks();
        }

        await app.listen(port, host);

        const appUrl = await app.getUrl();
        logger.log(`API server running on: ${appUrl}`);
    } catch (error) {
        console.error('API failed to start:', error);
        if (app) await app.close();
        process.exit(1);
    }
}

async function bootstrapWorker(): Promise<void> {
    let app: any;

    try {
        app = await NestFactory.createApplicationContext(WorkerAppModule, {
            bufferLogs: true,
        });

        const logger = app.get(Logger);
        app.useLogger(logger);

        // Workers always run with shutdown hooks so Bull can drain in-flight jobs
        app.enableShutdownHooks();

        const gracefulShutdown = async (signal: string) => {
            logger.log(
                `Worker received ${signal}, shutting down gracefully...`
            );
            await app.close();
            process.exit(0);
        };
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        logger.log('Worker process started — listening for queue jobs');
    } catch (error) {
        console.error('Worker failed to start:', error);
        if (app) await app.close();
        process.exit(1);
    }
}

if (APP_ROLE === 'worker') {
    bootstrapWorker();
} else {
    bootstrapApi();
}
