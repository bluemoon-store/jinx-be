import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectQueue } from '@nestjs/bull';
import {
    BadRequestException,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
} from '@nestjs/common';
import axios from 'axios';
import { Queue } from 'bull';
import { Cache } from 'cache-manager';
import { PinoLogger } from 'nestjs-pino';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { CryptoCurrency, Role } from '@prisma/client';

import { isValidAddress } from 'src/modules/crypto-payment/utils/crypto.util';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    IScheduledMaintenancePayload,
    ISendEmailBasePayload,
} from 'src/common/helper/interfaces/email.interface';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';

import {
    BUYER_PROTECTION_SETTINGS_CATEGORY,
    BUYER_PROTECTION_SETTINGS_KEY,
    BuyerProtectionConfig,
    DEFAULT_BUYER_PROTECTION,
} from '../constants/buyer-protection-settings.constant';
import {
    PAYMENT_CRYPTO_CODES,
    PAYMENT_GATEWAY_CODES,
    PAYMENT_SETTINGS_CATEGORY,
    PAYMENT_TELEGRAM_STAR_USD_RATE_KEY,
} from '../constants/payment-settings.constant';
import { SettingsUpdateBuyerProtectionRequestDto } from '../dtos/request/settings.update-buyer-protection.request';
import { SettingsScheduleMaintenanceRequestDto } from '../dtos/request/settings.schedule-maintenance.request';
import { SettingsUpdateGeneralRequestDto } from '../dtos/request/settings.update-general.request';
import { SettingsUpdateLandingRequestDto } from '../dtos/request/settings.update-landing.request';
import { SettingsUpdatePaymentRequestDto } from '../dtos/request/settings.update-payment.request';
import { SettingsUpdateSocialRequestDto } from '../dtos/request/settings.update-social.request';
import { SettingsEmailValidityTestResponseDto } from '../dtos/response/settings.email-validity-test.response';
import { SettingsGeneralResponseDto } from '../dtos/response/settings.general.response';
import { SettingsLandingResponseDto } from '../dtos/response/settings.landing.response';
import { SettingsPaymentResponseDto } from '../dtos/response/settings.payment.response';
import { SettingsBuyerProtectionResponseDto } from '../dtos/response/settings.buyer-protection.response';
import { SettingsPublicResponseDto } from '../dtos/response/settings.public.response';
import { SettingsSocialResponseDto } from '../dtos/response/settings.social.response';

const CACHE_KEY = 'settings:public';
const LANDING_CACHE_KEY = 'settings:landing';
const PAYMENT_METHODS_CACHE_KEY = 'settings:payment-methods';
const BUYER_PROTECTION_CACHE_KEY = 'settings:buyer-protection';
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

// Default copy for the scheduled-maintenance email. Used whenever the admin
// leaves a field blank, so the email always renders complete. Keep these in
// sync with the prefilled defaults in the admin UI (settings-screen.tsx).
const DEFAULT_MAINTENANCE_COPY = {
    subject: 'Scheduled maintenance notice',
    title: 'Scheduled Maintenance',
    intro:
        'Jinx.to Store will be temporarily unavailable while we perform scheduled maintenance.\n\n' +
        "We're working on improvements to make your Jinx.to Store experience smoother, faster, and more reliable.",
    impactNote:
        'During this time, you may not be able to access your dashboard, place orders, use wallet features, or manage your account.',
    apologyNote:
        'We regret any inconvenience caused and appreciate your patience while we complete the maintenance.',
} as const;

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

    // Merge an admin patch over a base config. Only the keys present in the
    // patch (and present in nested plan objects) override the base, so a
    // partial PUT — or an older/partial stored row — still yields a complete,
    // renderable config.
    private mergeBuyerProtection(
        base: BuyerProtectionConfig,
        patch?: Partial<SettingsUpdateBuyerProtectionRequestDto>
    ): BuyerProtectionConfig {
        if (!patch) return base;
        return {
            enabled: patch.enabled ?? base.enabled,
            heading: patch.heading ?? base.heading,
            subheading: patch.subheading ?? base.subheading,
            footerText: patch.footerText ?? base.footerText,
            enhanced: {
                title: patch.enhanced?.title ?? base.enhanced.title,
                badge: patch.enhanced?.badge ?? base.enhanced.badge,
                icon: patch.enhanced?.icon ?? base.enhanced.icon,
                priceMode: patch.enhanced?.priceMode ?? base.enhanced.priceMode,
                priceUsd: patch.enhanced?.priceUsd ?? base.enhanced.priceUsd,
                pricePercent:
                    patch.enhanced?.pricePercent ?? base.enhanced.pricePercent,
                benefits: patch.enhanced?.benefits ?? base.enhanced.benefits,
            },
            basic: {
                title: patch.basic?.title ?? base.basic.title,
                icon: patch.basic?.icon ?? base.basic.icon,
                benefits: patch.basic?.benefits ?? base.basic.benefits,
            },
        };
    }

    private parseStoredBuyerProtection(
        value: string | undefined
    ): BuyerProtectionConfig {
        if (!value) return DEFAULT_BUYER_PROTECTION;
        try {
            const parsed = JSON.parse(value) as Partial<BuyerProtectionConfig>;
            // Re-merge over defaults so any missing field (added after the row
            // was written) is backfilled rather than rendering as undefined.
            return this.mergeBuyerProtection(
                DEFAULT_BUYER_PROTECTION,
                parsed as SettingsUpdateBuyerProtectionRequestDto
            );
        } catch {
            return DEFAULT_BUYER_PROTECTION;
        }
    }

    async getBuyerProtection(): Promise<SettingsBuyerProtectionResponseDto> {
        const cached = await this.cacheManager.get<BuyerProtectionConfig>(
            BUYER_PROTECTION_CACHE_KEY
        );
        if (cached) return cached;

        const row = await this.databaseService.systemSettings.findUnique({
            where: { key: BUYER_PROTECTION_SETTINGS_KEY },
            select: { value: true },
        });
        const config = this.parseStoredBuyerProtection(row?.value);

        await this.cacheManager.set(
            BUYER_PROTECTION_CACHE_KEY,
            config,
            CACHE_TTL_MS
        );
        return config;
    }

    async updateBuyerProtection(
        payload: SettingsUpdateBuyerProtectionRequestDto
    ): Promise<SettingsBuyerProtectionResponseDto> {
        const row = await this.databaseService.systemSettings.findUnique({
            where: { key: BUYER_PROTECTION_SETTINGS_KEY },
            select: { value: true },
        });
        const current = this.parseStoredBuyerProtection(row?.value);
        const merged = this.mergeBuyerProtection(current, payload);

        await this.upsertSetting(
            BUYER_PROTECTION_SETTINGS_KEY,
            BUYER_PROTECTION_SETTINGS_CATEGORY,
            JSON.stringify(merged),
            true
        );
        await this.cacheManager.del(BUYER_PROTECTION_CACHE_KEY);

        return merged;
    }

    // Authoritative Enhanced-protection fee charged at order creation. Returns 0
    // when the feature is disabled, so a client that still sends
    // `buyerProtection:true` is never charged for a hidden step. In 'percent'
    // mode the fee is `pricePercent`% of the passed order subtotal (0 if no
    // subtotal is available).
    async getBuyerProtectionFeeUsd(subtotalUsd?: number): Promise<number> {
        const config = await this.getBuyerProtection();
        if (!config.enabled) return 0;

        if (config.enhanced.priceMode === 'percent') {
            const percent = Number(config.enhanced.pricePercent);
            const base = Number(subtotalUsd);
            if (
                !Number.isFinite(percent) ||
                percent <= 0 ||
                !Number.isFinite(base) ||
                base <= 0
            ) {
                return 0;
            }
            return Math.round((percent / 100) * base * 100) / 100;
        }

        const fee = Number(config.enhanced.priceUsd);
        return Number.isFinite(fee) && fee > 0 ? fee : 0;
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

    // Raw (unmasked) platform wallet address configured by admin for a crypto
    // method code. Returns null when unset/empty so callers can fall back to env.
    // Consumed by SystemWalletService when forwarding confirmed payments.
    async getCryptoPlatformAddress(code: string): Promise<string | null> {
        const row = await this.databaseService.systemSettings.findUnique({
            where: { key: this.cryptoAddressKey(code) },
            select: { value: true },
        });
        return this.normalizeNullable(row?.value ?? null);
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
            telegramStarUsdRate: this.parseStarRate(
                byKey.get(PAYMENT_TELEGRAM_STAR_USD_RATE_KEY)
            ),
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
                const normalized = this.normalizeNullable(item.address);
                // A non-empty address must be a valid wallet for its chain — a
                // typo here would forward confirmed funds to an invalid/wrong
                // destination. Clearing it (empty) is allowed; runtime falls
                // back to the PLATFORM_WALLET_* env.
                if (
                    normalized &&
                    !isValidAddress(normalized, item.code as CryptoCurrency)
                ) {
                    throw new BadRequestException(
                        `Invalid ${item.code} wallet address`
                    );
                }
                await this.upsertSetting(
                    this.cryptoAddressKey(item.code),
                    PAYMENT_SETTINGS_CATEGORY,
                    normalized,
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

        // Telegram Stars conversion rate (single key, not per-gateway).
        if (payload.telegramStarUsdRate !== undefined) {
            await this.upsertSetting(
                PAYMENT_TELEGRAM_STAR_USD_RATE_KEY,
                PAYMENT_SETTINGS_CATEGORY,
                String(payload.telegramStarUsdRate),
                false
            );
        }

        // Storefront reads the enabled-methods list from a cached endpoint; drop
        // the cache so admin toggles take effect immediately.
        await this.cacheManager.del(PAYMENT_METHODS_CACHE_KEY);

        return this.getPayment();
    }

    // Admin-set USD price of one Telegram Star, or null when unset/invalid so
    // the live flow can fall back to the env default. Kept DB-only here (this
    // service is intentionally decoupled from env config).
    async getTelegramStarUsdRate(): Promise<number | null> {
        const row = await this.databaseService.systemSettings.findUnique({
            where: { key: PAYMENT_TELEGRAM_STAR_USD_RATE_KEY },
            select: { value: true },
        });
        return this.parseStarRate(row?.value ?? null);
    }

    private parseStarRate(value: string | null | undefined): number | null {
        if (value == null) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
        // Admin-authored copy wins; blank fields fall back to the defaults so
        // the email always renders complete.
        const subject =
            payload.subject?.trim() || DEFAULT_MAINTENANCE_COPY.subject;
        const data: IScheduledMaintenancePayload = {
            date: payload.date,
            start_time: payload.startTime,
            end_time: payload.endTime,
            title: payload.title?.trim() || DEFAULT_MAINTENANCE_COPY.title,
            intro: payload.intro?.trim() || DEFAULT_MAINTENANCE_COPY.intro,
            impact_note:
                payload.impactNote?.trim() ||
                DEFAULT_MAINTENANCE_COPY.impactNote,
            apology_note:
                payload.apologyNote?.trim() ||
                DEFAULT_MAINTENANCE_COPY.apologyNote,
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

            // Await the enqueue calls so a Redis/queue failure surfaces as a
            // real error instead of being silently swallowed (which would let
            // the admin see a false success while no emails are sent).
            await Promise.all(
                batch
                    .filter(recipient => recipient.email)
                    .map(recipient => {
                        totalQueued++;
                        return this.emailQueue.add(
                            EMAIL_TEMPLATES.SCHEDULED_MAINTENANCE,
                            {
                                data,
                                toEmails: [recipient.email],
                                subject,
                            } as ISendEmailBasePayload<IScheduledMaintenancePayload>
                        );
                    })
            );

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
