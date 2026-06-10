import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';

import { DatabaseModule } from '../database/database.module';
import { HelperModule } from '../helper/helper.module';
import { UserModule } from 'src/modules/user/user.module';
import { WalletModule } from 'src/modules/wallet/wallet.module';

import { AuthPublicController } from './controllers/auth.public.controller';
import { JwtAccessStrategy } from './providers/access-jwt.strategy';
import { JwtRefreshStrategy } from './providers/refresh-jwt.strategy';
import { AuthService } from './services/auth.service';
import { TurnstileService } from './services/turnstile.service';

@Module({
    controllers: [AuthPublicController],
    imports: [
        HelperModule,
        PassportModule,
        DatabaseModule,
        UserModule,
        WalletModule,
        BullModule.registerQueue({
            name: APP_BULL_QUEUES.EMAIL,
        }),
        BullModule.registerQueue({
            name: APP_BULL_QUEUES.NOTIFICATION,
        }),
    ],
    providers: [
        AuthService,
        TurnstileService,
        JwtAccessStrategy,
        JwtRefreshStrategy,
    ],
    exports: [
        AuthService,
        TurnstileService,
        JwtAccessStrategy,
        JwtRefreshStrategy,
    ],
})
export class AuthModule {}
