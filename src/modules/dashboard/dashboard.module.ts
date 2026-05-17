import { Module } from '@nestjs/common';

import { DatabaseModule } from 'src/common/database/database.module';
import { RequestModule } from 'src/common/request/request.module';

import { DashboardAdminController } from './controllers/dashboard.admin.controller';
import { CustomerMetricsService } from './services/customer-metrics.service';
import { DashboardService } from './services/dashboard.service';
import { SalesMetricsService } from './services/sales-metrics.service';

@Module({
    imports: [DatabaseModule, RequestModule],
    controllers: [DashboardAdminController],
    providers: [DashboardService, SalesMetricsService, CustomerMetricsService],
    exports: [DashboardService],
})
export class DashboardModule {}
