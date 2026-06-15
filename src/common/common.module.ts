import { BullModule } from '@nestjs/bull';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as redisStore from 'cache-manager-ioredis';

import { AuthModule } from './auth/auth.module';
import configs from './config';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { CustomLoggerModule } from './logger/logger.module';
import { RequestModule } from './request/request.module';
import { ResponseModule } from './response/response.module';

@Module({
    imports: [
        // Configuration - Global
        ConfigModule.forRoot({
            load: configs,
            isGlobal: true,
            cache: true,
            envFilePath: ['.env'],
            expandVariables: true,
            // Fail-fast on a misconfigured deploy: in production a missing
            // required var throws here and the container never starts.
            validate: validateEnv,
        }),

        // Core Infrastructure
        DatabaseModule,
        AuthModule,

        // Cross-cutting Concerns
        CustomLoggerModule,
        RequestModule,
        ResponseModule,

        // Caching - Redis
        CacheModule.registerAsync({
            isGlobal: true,
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => ({
                store: redisStore,
                host: configService.get('redis.host'),
                port: configService.get('redis.port'),
                password: configService.get('redis.password'),
                tls: configService.get('redis.tls'),
                ttl: 5000,
            }),
            inject: [ConfigService],
        }),

        // Queue Management - Bull/Redis
        BullModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => ({
                redis: {
                    host: configService.get('redis.host'),
                    port: Number(configService.get('redis.port')),
                    password: configService.get('redis.password'),
                },
            }),
            inject: [ConfigService],
        }),
    ],
    exports: [DatabaseModule, CacheModule],
})
export class CommonModule {}
