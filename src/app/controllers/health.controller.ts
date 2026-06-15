import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

import { DatabaseService } from 'src/common/database/services/database.service';
import { PublicRoute } from 'src/common/request/decorators/request.public.decorator';
import { buildEnvReport, EnvReport } from 'src/common/config/env.validation';

@ApiTags('health')
@Controller({
    version: VERSION_NEUTRAL,
    path: '/health',
})
export class HealthController {
    constructor(
        private readonly healthCheckService: HealthCheckService,
        private readonly databaseService: DatabaseService
    ) {}

    @Get()
    @HealthCheck()
    @PublicRoute()
    public async getHealth() {
        return this.healthCheckService.check([
            () => this.databaseService.isHealthy(),
        ]);
    }

    /**
     * Env diagnostics — reports which environment variables are present on the
     * running instance so operators can verify a deploy. Public, like /health.
     * Secret values are NEVER returned (presence boolean only); only non-secret
     * config values are shown.
     */
    @Get('config')
    @PublicRoute()
    @ApiOperation({ summary: 'Env diagnostics (presence of each variable)' })
    public getConfig(): EnvReport {
        return buildEnvReport();
    }
}
