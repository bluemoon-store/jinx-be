import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectQueue } from '@nestjs/bull';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import axios from 'axios';
import { Queue } from 'bull';
import { Cache } from 'cache-manager';
import { PinoLogger } from 'nestjs-pino';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Role } from '@prisma/client';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    IScheduledMaintenancePayload,
    ISendEmailBasePayload,
} from 'src/common/helper/interfaces/email.interface';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';

import {
    PAYMENT_CRYPTO_CODES,
    PAYMENT_GATEWAY_CODES,
    PAYMENT_SETTINGS_CATEGORY,
} from '../constants/payment-settings.constant';
import { SettingsScheduleMaintenanceRequestDto } from '../dtos/request/settings.schedule-maintenance.request';
import { SettingsUpdateGeneralRequestDto } from '../dtos/request/settings.update-general.request';
import { SettingsUpdateLandingRequestDto } from '../dtos/request/settings.update-landing.request';
import { SettingsUpdatePaymentRequestDto } from '../dtos/request/settings.update-payment.request';
import { SettingsUpdateSocialRequestDto } from '../dtos/request/settings.update-social.request';
import { SettingsEmailValidityTestResponseDto } from '../dtos/response/settings.email-validity-test.response';
import { SettingsGeneralResponseDto } from '../dtos/response/settings.general.response';
import { SettingsLandingResponseDto } from '../dtos/response/settings.landing.response';
import { SettingsPaymentResponseDto } from '../dtos/response/settings.payment.response';
import { SettingsPublicResponseDto } from '../dtos/response/settings.public.response';
import { SettingsSocialResponseDto } from '../dtos/response/settings.social.response';

const CACHE_KEY = 'settings:public';
const LANDING_CACHE_KEY = 'settings:landing';
const PAYMENT_METHODS_CACHE_KEY = 'settings:payment-methods';
const CACHE_TTL_MS = 60_000;

const KEYS = {
    supportLink: 'support_link',
    telegramLink: 'telegram_link',
    discordLink: 'discord_link',
    landingHeroTitle: 'landing_hero_title',
    landingHeroSubtitle: 'landing_hero_subtitle',
    landingHotSellingDesc: 'landing_hot_selling_desc',
    landingFreshlyDesc: 'landing_freshly_desc',
    landingNewlyDesc: 'landing_newly_desc',
    landingHowToDesc: 'landing_how_to_desc',
    landingFeaturesDesc: 'landing_features_desc',
    landingFaqDesc: 'landing_faq_desc',
} as const;

const LANDING_KEY_LIST = [
    KEYS.landingHeroTitle,
    KEYS.landingHeroSubtitle,
    KEYS.landingHotSellingDesc,
    KEYS.landingFreshlyDesc,
    KEYS.landingNewlyDesc,
    KEYS.landingHowToDesc,
    KEYS.landingFeaturesDesc,
    KEYS.landingFaqDesc,
];

const LANDING_FIELD_TO_KEY: Record<
    keyof SettingsUpdateLandingRequestDto,
    string
> = {
    heroTitle: KEYS.landingHeroTitle,
    heroSubtitle: KEYS.landingHeroSubtitle,
    hotSellingDesc: KEYS.landingHotSellingDesc,
    freshlyDesc: KEYS.landingFreshlyDesc,
    newlyDesc: KEYS.landingNewlyDesc,
    howToDesc: KEYS.landingHowToDesc,
    featuresDesc: KEYS.landingFeaturesDesc,
    faqDesc: KEYS.landingFaqDesc,
};

@Injectable()
export class SettingsService {
    constructor(
        private readonly databaseService: DatabaseService,
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
        @InjectQueue(APP_BULL_QUEUES.EMAIL)
        private readonly emailQueue: Queue,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(SettingsService.name);
    }

    private normalizeNullable(value?: string | null): string | null {
        if (value == null) return null;
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    }

    private toPublicNullable(value: string | null): string | null {
        if (value == null) return null;
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    }

    private async upsertSetting(
        key: string,
        category: string,
        value: string | null,
        isPublic = true
    ): Promise<void> {
        await this.databaseService.systemSettings.upsert({
            where: { key },
            update: { value: value ?? '', category, isPublic },
            create: { key, value: value ?? '', category, isPublic },
        });
    }

    async getGeneral(): Promise<SettingsGeneralResponseDto> {
        const row = await this.databaseService.systemSettings.findUnique({
            where: { key: KEYS.supportLink },
        });
        return { supportLink: this.toPublicNullable(row?.value ?? null) };
    }

    async updateGeneral(
        payload: SettingsUpdateGeneralRequestDto
    ): Promise<SettingsGeneralResponseDto> {
        if (payload.supportLink !== undefined) {
            await this.upsertSetting(
                KEYS.supportLink,
                'general',
                this.normalizeNullable(payload.supportLink)
            );
            await this.cacheManager.del(CACHE_KEY);
        }
        return this.getGeneral();
    }

    async getSocial(): Promise<SettingsSocialResponseDto> {
        const rows = await this.databaseService.systemSettings.findMany({
            where: { key: { in: [KEYS.telegramLink, KEYS.discordLink] } },
            select: { key: true, value: true },
        });
        const byKey = new Map(rows.map(row => [row.key, row.value]));
        return {
            telegramLink: this.toPublicNullable(
                byKey.get(KEYS.telegramLink) ?? null
            ),
            discordLink: this.toPublicNullable(
                byKey.get(KEYS.discordLink) ?? null
            ),
        };
    }

    async updateSocial(
        payload: SettingsUpdateSocialRequestDto
    ): Promise<SettingsSocialResponseDto> {
        let didUpdate = false;
        if (payload.telegramLink !== undefined) {
            await this.upsertSetting(
                KEYS.telegramLink,
                'social',
                this.normalizeNullable(payload.telegramLink)
            );
            didUpdate = true;
        }
        if (payload.discordLink !== undefined) {
            await this.upsertSetting(
                KEYS.discordLink,
                'social',
                this.normalizeNullable(payload.discordLink)
            );
            didUpdate = true;
        }
        if (didUpdate) {
            await this.cacheManager.del(CACHE_KEY);
        }
        return this.getSocial();
    }

    async getLanding(): Promise<SettingsLandingResponseDto> {
        const cached =
            await this.cacheManager.get<SettingsLandingResponseDto>(
                LANDING_CACHE_KEY
            );
        if (cached) return cached;

        const rows = await this.databaseService.systemSettings.findMany({
            where: { key: { in: LANDING_KEY_LIST } },
            select: { key: true, value: true },
        });
        const byKey = new Map(rows.map(row => [row.key, row.value]));
        const out: SettingsLandingResponseDto = {
            heroTitle: this.toPublicNullable(
                byKey.get(KEYS.landingHeroTitle) ?? null
            ),
            heroSubtitle: this.toPublicNullable(
                byKey.get(KEYS.landingHeroSubtitle) ?? null
            ),
            hotSellingDesc: this.toPublicNullable(
                byKey.get(KEYS.landingHotSellingDesc) ?? null
            ),
            freshlyDesc: this.toPublicNullable(
                byKey.get(KEYS.landingFreshlyDesc) ?? null
            ),
            newlyDesc: this.toPublicNullable(
                byKey.get(KEYS.landingNewlyDesc) ?? null
            ),
            howToDesc: this.toPublicNullable(
                byKey.get(KEYS.landingHowToDesc) ?? null
            ),
            featuresDesc: this.toPublicNullable(
                byKey.get(KEYS.landingFeaturesDesc) ?? null
            ),
            faqDesc: this.toPublicNullable(
                byKey.get(KEYS.landingFaqDesc) ?? null
            ),
        };

        await this.cacheManager.set(LANDING_CACHE_KEY, out, CACHE_TTL_MS);
        return out;
    }

    async updateLanding(
        payload: SettingsUpdateLandingRequestDto
    ): Promise<SettingsLandingResponseDto> {
        let didUpdate = false;
        for (const [field, key] of Object.entries(LANDING_FIELD_TO_KEY) as [
            keyof SettingsUpdateLandingRequestDto,
            string,
        ][]) {
            const value = payload[field];
            if (value === undefined) continue;
            await this.upsertSetting(
                key,
                'landing',
                this.normalizeNullable(value)
            );
            didUpdate = true;
        }
        if (didUpdate) {
            await this.cacheManager.del(LANDING_CACHE_KEY);
        }
        return this.getLanding();
    }

    private cryptoAddressKey(code: string): string {
        return `payment_crypto_${code.toLowerCase()}_address`;
    }

    private cryptoEnabledKey(code: string): string {
        return `payment_crypto_${code.toLowerCase()}_enabled`;
    }

    private gatewayApiKeyKey(code: string): string {
        return `payment_gateway_${code.toLowerCase()}_api_key`;
    }

    private gatewayApiSecretKey(code: string): string {
        return `payment_gateway_${code.toLowerCase()}_api_secret`;
    }

    private gatewayEnabledKey(code: string): string {
        return `payment_gateway_${code.toLowerCase()}_enabled`;
    }

    // Missing key defaults to enabled so methods stay visible until toggled off.
    private parseEnabled(value: string | undefined): boolean {
        if (value == null) return true;
        return value !== 'false';
    }

    async getPayment(): Promise<SettingsPaymentResponseDto> {
        const rows = await this.databaseService.systemSettings.findMany({
            where: { category: PAYMENT_SETTINGS_CATEGORY },
            select: { key: true, value: true },
        });
        const byKey = new Map(rows.map(row => [row.key, row.value]));

        return {
            cryptocurrencies: PAYMENT_CRYPTO_CODES.map(code => ({
                code,
                address: this.toPublicNullable(
                    byKey.get(this.cryptoAddressKey(code)) ?? null
                ),
                enabled: this.parseEnabled(
                    byKey.get(this.cryptoEnabledKey(code))
                ),
            })),
            gateways: PAYMENT_GATEWAY_CODES.map(code => ({
                code,
                apiKey: this.toPublicNullable(
                    byKey.get(this.gatewayApiKeyKey(code)) ?? null
                ),
                apiSecret: this.toPublicNullable(
                    byKey.get(this.gatewayApiSecretKey(code)) ?? null
                ),
                enabled: this.parseEnabled(
                    byKey.get(this.gatewayEnabledKey(code))
                ),
            })),
        };
    }

    async updatePayment(
        payload: SettingsUpdatePaymentRequestDto
    ): Promise<SettingsPaymentResponseDto> {
        const allowedCrypto = new Set<string>(PAYMENT_CRYPTO_CODES);
        const allowedGateway = new Set<string>(PAYMENT_GATEWAY_CODES);

        for (const item of payload.cryptocurrencies ?? []) {
            if (!allowedCrypto.has(item.code)) continue;
            if (item.address !== undefined) {
                await this.upsertSetting(
                    this.cryptoAddressKey(item.code),
                    PAYMENT_SETTINGS_CATEGORY,
                    this.normalizeNullable(item.address),
                    false
                );
            }
            if (item.enabled !== undefined) {
                await this.upsertSetting(
                    this.cryptoEnabledKey(item.code),
                    PAYMENT_SETTINGS_CATEGORY,
                    item.enabled ? 'true' : 'false',
                    false
                );
            }
        }

        for (const item of payload.gateways ?? []) {
            if (!allowedGateway.has(item.code)) continue;
            if (item.apiKey !== undefined) {
                await this.upsertSetting(
                    this.gatewayApiKeyKey(item.code),
                    PAYMENT_SETTINGS_CATEGORY,
                    this.normalizeNullable(item.apiKey),
                    false
                );
            }
            if (item.apiSecret !== undefined) {
                await this.upsertSetting(
                    this.gatewayApiSecretKey(item.code),
                    PAYMENT_SETTINGS_CATEGORY,
                    this.normalizeNullable(item.apiSecret),
                    false
                );
            }
            if (item.enabled !== undefined) {
                await this.upsertSetting(
                    this.gatewayEnabledKey(item.code),
                    PAYMENT_SETTINGS_CATEGORY,
                    item.enabled ? 'true' : 'false',
                    false
                );
            }
        }

        // Storefront reads the enabled-methods list from a cached endpoint; drop
        // the cache so admin toggles take effect immediately.
        await this.cacheManager.del(PAYMENT_METHODS_CACHE_KEY);

        return this.getPayment();
    }

    // Public, secret-free view of which methods are enabled. Consumed by the
    // storefront to hide disabled methods and by the payment services to reject
    // a disabled method chosen via a direct API call.
    async getEnabledPaymentMethods(): Promise<{
        cryptocurrencies: string[];
        gateways: string[];
    }> {
        const cached = await this.cacheManager.get<{
            cryptocurrencies: string[];
            gateways: string[];
        }>(PAYMENT_METHODS_CACHE_KEY);
        if (cached) return cached;

        const rows = await this.databaseService.systemSettings.findMany({
            where: { category: PAYMENT_SETTINGS_CATEGORY },
            select: { key: true, value: true },
        });
        const byKey = new Map(rows.map(row => [row.key, row.value]));

        const out = {
            cryptocurrencies: PAYMENT_CRYPTO_CODES.filter(code =>
                this.parseEnabled(byKey.get(this.cryptoEnabledKey(code)))
            ),
            gateways: PAYMENT_GATEWAY_CODES.filter(code =>
                this.parseEnabled(byKey.get(this.gatewayEnabledKey(code)))
            ),
        };

        await this.cacheManager.set(
            PAYMENT_METHODS_CACHE_KEY,
            out,
            CACHE_TTL_MS
        );
        return out;
    }

    async getPublic(): Promise<SettingsPublicResponseDto> {
        const cached =
            await this.cacheManager.get<SettingsPublicResponseDto>(CACHE_KEY);
        if (cached) return cached;

        const rows = await this.databaseService.systemSettings.findMany({
            where: {
                isPublic: true,
                key: {
                    in: [KEYS.supportLink, KEYS.telegramLink, KEYS.discordLink],
                },
            },
            select: { key: true, value: true },
        });
        const byKey = new Map(rows.map(row => [row.key, row.value]));
        const out = {
            supportLink: this.toPublicNullable(
                byKey.get(KEYS.supportLink) ?? null
            ),
            telegramLink: this.toPublicNullable(
                byKey.get(KEYS.telegramLink) ?? null
            ),
            discordLink: this.toPublicNullable(
                byKey.get(KEYS.discordLink) ?? null
            ),
        };

        await this.cacheManager.set(CACHE_KEY, out, CACHE_TTL_MS);
        return out;
    }

    private isBlockedIp(host: string): boolean {
        const version = isIP(host);
        if (!version) return false;
        if (version === 4) {
            const [a, b] = host.split('.').map(Number);
            if (a === 127 || a === 10 || a === 0) return true;
            if (a === 169 && b === 254) return true;
            if (a === 192 && b === 168) return true;
            if (a === 172 && b >= 16 && b <= 31) return true;
            return false;
        }
        const normalized = host.toLowerCase();
        return (
            normalized === '::1' ||
            normalized.startsWith('fe80:') ||
            normalized.startsWith('fc') ||
            normalized.startsWith('fd')
        );
    }

    private async assertPublicHost(hostname: string): Promise<void> {
        if (hostname.toLowerCase() === 'localhost') {
            throw new HttpException(
                'settings.error.privateHostBlocked',
                HttpStatus.BAD_REQUEST
            );
        }
        const resolved = await lookup(hostname, { all: true });
        if (!resolved.length) {
            throw new HttpException(
                'settings.error.dnsResolutionFailed',
                HttpStatus.BAD_REQUEST
            );
        }
        for (const item of resolved) {
            if (this.isBlockedIp(item.address)) {
                throw new HttpException(
                    'settings.error.privateHostBlocked',
                    HttpStatus.BAD_REQUEST
                );
            }
        }
    }

    private assertRedirectHost(hostname?: string): void {
        if (!hostname) return;
        const lowered = hostname.toLowerCase();
        if (lowered === 'localhost' || this.isBlockedIp(lowered)) {
            throw new HttpException(
                'settings.error.privateHostBlocked',
                HttpStatus.BAD_REQUEST
            );
        }
    }

    async testEmailValidityUrl(
        url: string
    ): Promise<SettingsEmailValidityTestResponseDto> {
        const parsed = new URL(url);
        await this.assertPublicHost(parsed.hostname);

        const started = Date.now();
        try {
            const response = await axios.get(url, {
                timeout: 5000,
                maxRedirects: 3,
                validateStatus: () => true,
                responseType: 'text',
                beforeRedirect: options => {
                    this.assertRedirectHost(options.hostname);
                },
            });
            return {
                ok: response.status >= 200 && response.status < 400,
                status: response.status,
                latencyMs: Date.now() - started,
            };
        } catch (error) {
            return {
                ok: false,
                status: null,
                latencyMs: Date.now() - started,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    public async broadcastMaintenanceNotice(
        payload: SettingsScheduleMaintenanceRequestDto
    ): Promise<ApiGenericResponseDto> {
        const data: IScheduledMaintenancePayload = {
            date: payload.date,
            start_time: payload.startTime,
            end_time: payload.endTime,
        };

        const batchSize = 200;
        let cursor: string | undefined;
        let totalQueued = 0;

        // Iterate via keyset pagination to handle large user bases without
        // loading every row into memory at once.
        while (true) {
            const batch = await this.databaseService.user.findMany({
                where: { deletedAt: null, isBanned: false, role: Role.USER },
                select: { id: true, email: true },
                orderBy: { id: 'asc' },
                take: batchSize,
                ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            });

            if (batch.length === 0) break;

            for (const recipient of batch) {
                if (!recipient.email) continue;
                this.emailQueue.add(EMAIL_TEMPLATES.SCHEDULED_MAINTENANCE, {
                    data,
                    toEmails: [recipient.email],
                } as ISendEmailBasePayload<IScheduledMaintenancePayload>);
                totalQueued++;
            }

            cursor = batch[batch.length - 1].id;
            if (batch.length < batchSize) break;
        }

        this.logger.info(
            { totalQueued, payload },
            'Scheduled-maintenance notice queued'
        );

        return {
            success: true,
            message: 'settings.success.maintenanceScheduled',
        };
    }
}
