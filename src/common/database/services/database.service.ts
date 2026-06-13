import { Injectable, OnModuleInit } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit {
    constructor() {
        super({
            // Defaults for interactive ($transaction) transactions. The Prisma
            // default timeout (5000ms) is too tight for multi-item checkout
            // flows on a slow/remote DB, causing "Transaction not found" errors
            // when later statements run after the tx has already closed.
            transactionOptions: {
                maxWait: 5000, // max time to acquire a connection from the pool
                timeout: 15000, // max interactive-transaction runtime
            },
        });
    }

    async onModuleInit() {
        await this.$connect();
    }

    async isHealthy(): Promise<HealthIndicatorResult> {
        try {
            await this.$queryRaw`SELECT 1`;
            return Promise.resolve({
                prisma: {
                    status: 'up',
                },
            });
        } catch {
            return Promise.resolve({
                prisma: {
                    status: 'down',
                },
            });
        }
    }
}
