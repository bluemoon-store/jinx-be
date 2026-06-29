import { Injectable } from '@nestjs/common';
import { ContentType } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { Command } from 'nestjs-command';

import { DatabaseService } from 'src/common/database/services/database.service';

@Injectable()
export class StoreSettingsSeedService {
    constructor(
        private readonly logger: PinoLogger,
        private readonly databaseService: DatabaseService
    ) {
        this.logger.setContext(StoreSettingsSeedService.name);
    }

    @Command({
        command: 'seed:store-settings',
        describe: 'Seed store settings, legal docs, and faq defaults',
    })
    async seed(): Promise<void> {
        await this.seedSystemSettings();
        await this.seedLegal();
        await this.seedFaq();
        this.logger.info('Store settings seeding finished');
    }

    // Maps an admin crypto method code to the chain-keyed PLATFORM_WALLET_* env
    // var so existing env-configured addresses surface in admin and drive the
    // live forwarding flow (which now reads DB-first, env as fallback).
    private platformWalletEnv(code: string): string {
        const envByCode: Record<string, string | undefined> = {
            btc: process.env.PLATFORM_WALLET_BTC,
            eth: process.env.PLATFORM_WALLET_ETH,
            sol: process.env.PLATFORM_WALLET_SOL,
            usdt_trc20: process.env.PLATFORM_WALLET_TRX,
            usdt_erc20: process.env.PLATFORM_WALLET_ETH,
            ltc: process.env.PLATFORM_WALLET_LTC,
            bch: process.env.PLATFORM_WALLET_BCH,
        };
        return (envByCode[code] ?? '').trim();
    }

    private async seedSystemSettings(): Promise<void> {
        const paymentCryptoCodes = [
            'btc',
            'eth',
            'sol',
            'usdt_trc20',
            'usdt_erc20',
            'ltc',
            'bch',
        ];
        const paymentGatewayCodes = [
            'chime',
            'cashapp',
            'applepay',
            'googlepay',
        ];

        const paymentRows = [
            ...paymentCryptoCodes.flatMap(code => [
                {
                    key: `payment_crypto_${code}_address`,
                    category: 'payment',
                    value: this.platformWalletEnv(code),
                    isPublic: false,
                },
                {
                    key: `payment_crypto_${code}_enabled`,
                    category: 'payment',
                    value: 'true',
                    isPublic: false,
                },
            ]),
            ...paymentGatewayCodes.flatMap(code => [
                {
                    key: `payment_gateway_${code}_api_key`,
                    category: 'payment',
                    value: '',
                    isPublic: false,
                },
                {
                    key: `payment_gateway_${code}_api_secret`,
                    category: 'payment',
                    value: '',
                    isPublic: false,
                },
                {
                    key: `payment_gateway_${code}_enabled`,
                    category: 'payment',
                    value: 'true',
                    isPublic: false,
                },
            ]),
        ];

        const rows = [
            {
                key: 'support_link',
                category: 'general',
                value: '',
                isPublic: true,
            },
            {
                key: 'telegram_link',
                category: 'social',
                value: '',
                isPublic: true,
            },
            {
                key: 'discord_link',
                category: 'social',
                value: '',
                isPublic: true,
            },
            ...paymentRows,
        ];

        for (const row of rows) {
            await this.databaseService.systemSettings.upsert({
                where: { key: row.key },
                update: { category: row.category, isPublic: row.isPublic },
                create: row,
            });
        }

        // Backfill platform wallet addresses from PLATFORM_WALLET_* env for rows
        // that already exist but are still empty (the upsert above never touches
        // `value`, so admin-set addresses are preserved). This is what makes the
        // env-configured addresses visible in admin on existing deployments.
        for (const code of paymentCryptoCodes) {
            const envValue = this.platformWalletEnv(code);
            if (!envValue) continue;
            const key = `payment_crypto_${code}_address`;
            const existing =
                await this.databaseService.systemSettings.findUnique({
                    where: { key },
                    select: { value: true },
                });
            if (existing && existing.value.trim().length === 0) {
                await this.databaseService.systemSettings.update({
                    where: { key },
                    data: { value: envValue },
                });
            }
        }
    }

    private async seedLegal(): Promise<void> {
        const docs = [
            {
                key: 'legal:terms',
                type: ContentType.TERMS,
                title: 'Terms of Service',
                content: `<h2>Overview</h2><p>These terms govern your access to Jinxto websites, apps, and related services.</p><h2>Eligibility and Accounts</h2><ul><li>You must be at least 13 years old to use our services.</li><li>You are responsible for safeguarding your account credentials and for all activity under your account.</li><li>We may suspend or terminate accounts that violate these terms or pose risk to the platform.</li></ul><h2>Acceptable Use</h2><ul><li>You may not use Jinxto for unlawful, fraudulent, or abusive purposes.</li><li>You may not probe, scan, or test the vulnerability of our systems without authorization.</li><li>You may not reverse engineer, decompile, or attempt to extract source code except where permitted by law.</li><li>You may not distribute malware or interfere with the integrity or performance of the service.</li></ul><h2>Fees, Trials, and Billing (If Applicable)</h2><p>Where fees apply, you agree to pay amounts shown at checkout. Subscriptions or renewals will continue according to the terms presented at purchase unless cancelled. You authorize us to charge your chosen payment method for applicable fees.</p>`,
            },
            {
                key: 'legal:privacy',
                type: ContentType.PRIVACY,
                title: 'Privacy Policy',
                content: `<h2>Information We Collect</h2><p>We collect information you provide directly, such as account details and order information, and technical data needed to operate and secure the service.</p><h2>How We Use Information</h2><p>We use data to provide and improve Jinxto, process transactions, communicate with you, and comply with legal obligations.</p><h2>Your Choices</h2><p>You may access or update certain account information in settings. Where applicable, you can opt out of marketing communications.</p>`,
            },
            {
                key: 'legal:refund',
                type: ContentType.REFUND,
                title: 'Refund Policy',
                content: `<h2>Eligibility</h2><p>Refund eligibility depends on the product type, order status, and the policies shown at checkout.</p><h2>How to Request</h2><p>Submit refund requests through your order history or support channels. We will review and respond according to applicable rules.</p><h2>Timing</h2><p>Approved refunds are processed to the original payment method when possible; timing may vary by bank or card issuer.</p>`,
            },
            {
                key: 'legal:cookie',
                type: ContentType.COOKIE,
                title: 'Cookie Policy',
                content: `<h2>What Are Cookies</h2><p>Cookies are small files stored on your device that help us run the site, remember preferences, and understand usage.</p><h2>How We Use Them</h2><p>We use essential cookies for security and core functionality, and optional cookies for analytics or preferences where allowed.</p><h2>Managing Cookies</h2><p>You can control cookies through your browser settings. Disabling some cookies may limit certain features.</p>`,
            },
        ];

        for (const doc of docs) {
            await this.databaseService.cmsContent.upsert({
                where: { key: doc.key },
                update: {
                    type: doc.type,
                    title: doc.title,
                    content: doc.content,
                    isPublished: true,
                    deletedAt: null,
                },
                create: { ...doc, isPublished: true },
            });
        }
    }

    private async seedFaq(): Promise<void> {
        const categories = [
            {
                name: 'General',
                slug: 'general',
                position: 0,
                items: [
                    {
                        question:
                            'What kind of digital giftcards does Jinxto offer?',
                        answerHtml:
                            '<p>Jinxto offers a wide variety of digital giftcards across categories including food and dining, streaming services, and more.</p>',
                    },
                    {
                        question: 'What makes Jinxto safe to shop on?',
                        answerHtml:
                            '<p>We use industry-standard security, verification, and fraud monitoring for every purchase.</p>',
                    },
                    {
                        question: 'Can I use other cryptocurrencies to shop?',
                        answerHtml:
                            '<p>Supported cryptocurrencies are listed at checkout. Availability may vary by region.</p>',
                    },
                    {
                        question: 'How do I browse for giftcards?',
                        answerHtml:
                            '<p>Use search and category filters on the storefront to find giftcards by brand or type.</p>',
                    },
                ],
            },
            {
                name: 'Orders',
                slug: 'orders',
                position: 1,
                items: [
                    {
                        question: 'Where can I find my order after purchasing?',
                        answerHtml:
                            '<p>After purchase, open <strong>Orders</strong> in your account to view status and details.</p>',
                    },
                ],
            },
        ];

        for (const category of categories) {
            const row = await this.databaseService.faqCategory.upsert({
                where: { slug: category.slug },
                update: {
                    name: category.name,
                    position: category.position,
                    deletedAt: null,
                },
                create: {
                    name: category.name,
                    slug: category.slug,
                    position: category.position,
                },
            });

            const count = await this.databaseService.faqItem.count({
                where: { categoryId: row.id, deletedAt: null },
            });
            if (count > 0) continue;

            await this.databaseService.faqItem.createMany({
                data: category.items.map((item, index) => ({
                    categoryId: row.id,
                    question: item.question,
                    answerHtml: item.answerHtml,
                    position: index,
                })),
            });
        }
    }
}
