import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseModule } from 'src/common/database/database.module';
import { RequestModule } from 'src/common/request/request.module';
import { HelperModule } from 'src/common/helper/helper.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { WalletModule } from 'src/modules/wallet/wallet.module';
import { CartModule } from 'src/modules/cart/cart.module';
import { CouponModule } from 'src/modules/coupon/coupon.module';
import { ActivityLogModule } from 'src/modules/activity-log/activity-log.module';
import { StockLineModule } from 'src/modules/stock-line/stock-line.module';
import { TicketModule } from 'src/modules/ticket/ticket.module';

import { OrderPublicController } from './controllers/order.public.controller';
import { OrderAdminController } from './controllers/order.admin.controller';
import { OrderService } from './services/order.service';
import { OrderDeliveryService } from './services/order-delivery.service';

@Module({
    imports: [
        DatabaseModule,
        HelperModule,
        StorageModule,
        WalletModule,
        CartModule,
        CouponModule,
        RequestModule,
        ActivityLogModule,
        StockLineModule,
        TicketModule,
        BullModule.registerQueue({
            name: APP_BULL_QUEUES.EMAIL,
        }),
    ],
    controllers: [OrderPublicController, OrderAdminController],
    providers: [OrderService, OrderDeliveryService],
    exports: [OrderService, OrderDeliveryService],
})
export class OrderModule {}
