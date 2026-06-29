import { Injectable, BadRequestException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PaymentGateway } from '@prisma/client';

import { IPaymentGateway } from '../interfaces/payment-gateway.interface';
import { ChimeGateway } from './chime-gateway.service';
import { ManualP2PGateway } from './manual-p2p-gateway.service';
import { TelegramStarsGateway } from './telegram-stars-gateway.service';

/**
 * Payment Gateway Factory
 * Resolves the IPaymentGateway implementation for a given PaymentGateway enum.
 * New providers register themselves here (mirrors BlockchainProviderFactory).
 */
@Injectable()
export class PaymentGatewayFactory {
    private readonly gateways: Map<PaymentGateway, IPaymentGateway>;

    constructor(
        private readonly logger: PinoLogger,
        private readonly chimeGateway: ChimeGateway,
        private readonly telegramStarsGateway: TelegramStarsGateway,
        private readonly manualP2PGateway: ManualP2PGateway
    ) {
        this.logger.setContext(PaymentGatewayFactory.name);
        this.gateways = new Map();
        this.gateways.set(PaymentGateway.CHIME, this.chimeGateway);
        this.gateways.set(
            PaymentGateway.TELEGRAM_STARS,
            this.telegramStarsGateway
        );
        this.gateways.set(PaymentGateway.MANUAL_P2P, this.manualP2PGateway);

        this.logger.info(
            { supportedGateways: Array.from(this.gateways.keys()) },
            'Fiat payment gateways initialized'
        );
    }

    getGateway(gateway: PaymentGateway): IPaymentGateway {
        const impl = this.gateways.get(gateway);
        if (!impl) {
            throw new BadRequestException(
                `No payment gateway implementation for ${gateway}`
            );
        }
        return impl;
    }

    isSupported(gateway: PaymentGateway): boolean {
        return this.gateways.has(gateway);
    }
}
