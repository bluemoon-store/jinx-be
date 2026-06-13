import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
    DeliveryType,
    Prisma,
    Product,
    ProductCategory,
    StockLineStatus,
} from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { Command } from 'nestjs-command';
import { DatabaseService } from 'src/common/database/services/database.service';
import { hashStockLineContent } from 'src/modules/stock-line/utils/stock-line-hash.util';

type CategorySlug =
    | 'cashout'
    | 'hotels'
    | 'food'
    | 'flights'
    | 'groceries'
    | 'shopping'
    | 'clothing'
    | 'gas-oil'
    | 'tickets'
    | 'lifestyle'
    | 'jewelry'
    | 'rentals'
    | 'streaming';

type ProductSlug =
    | 'speedway-giftcards'
    | 'southwest-airlines'
    | 'ihg'
    | 'british-airways'
    | 'pc-optimum'
    | 'harveys';

type ProductSeedDef = {
    slug: ProductSlug;
    name: string;
    categorySlug: CategorySlug;
    description: string;
    isHot: boolean;
    isNew: boolean;
    isRestocked: boolean;
    sortOrder: number;
    shortNotice: string;
    deliveryContent: string;
    redeemProcess: string;
    warrantyText: string;
    countryOfOrigin: string;
    launchedAt: Date | null;
    restockedAt: Date | null;
    flair?: string;
};

const CATEGORY_SEEDS: Array<{
    slug: CategorySlug;
    name: string;
    icon: string;
    description: string;
    sortOrder: number;
}> = [
    {
        slug: 'cashout',
        name: 'Cashout',
        icon: 'IconDollar',
        description:
            'Cards and balances you can move toward cash, wallets, or payouts.',
        sortOrder: 1,
    },
    {
        slug: 'hotels',
        name: 'Hotels',
        icon: 'IconFoodBell',
        description: 'Stays, resort credit, and hotel-branded gift cards.',
        sortOrder: 2,
    },
    {
        slug: 'food',
        name: 'Food',
        icon: 'IconCookies',
        description: 'Restaurants, delivery, and coffeehouse gift cards.',
        sortOrder: 3,
    },
    {
        slug: 'flights',
        name: 'Flights',
        icon: 'IconAirplane',
        description: 'Airline vouchers and flight gift cards.',
        sortOrder: 4,
    },
    {
        slug: 'groceries',
        name: 'Groceries',
        icon: 'IconApples',
        description: 'Supermarkets, meal kits, and grocery delivery credit.',
        sortOrder: 5,
    },
    {
        slug: 'shopping',
        name: 'Shopping',
        icon: 'IconShoppingBag2',
        description: 'Retail and marketplace gift cards for everyday buys.',
        sortOrder: 6,
    },
    {
        slug: 'clothing',
        name: 'Clothing',
        icon: 'IconFashion',
        description: 'Apparel, footwear, and accessories.',
        sortOrder: 7,
    },
    {
        slug: 'gas-oil',
        name: 'Gas/Oil',
        icon: 'IconGas',
        description: 'Fuel brands and convenience store gift cards.',
        sortOrder: 8,
    },
    {
        slug: 'tickets',
        name: 'Tickets',
        icon: 'IconTicket',
        description: 'Concerts, sports, and live event ticketing.',
        sortOrder: 9,
    },
    {
        slug: 'lifestyle',
        name: 'Lifestyle',
        icon: 'IconPeopleIdCard',
        description: 'Fitness, apps, and everyday digital lifestyle perks.',
        sortOrder: 10,
    },
    {
        slug: 'jewelry',
        name: 'Jewelry',
        icon: 'IconDiamondShine',
        description: 'Fine jewelry and accessories gift cards.',
        sortOrder: 11,
    },
    {
        slug: 'rentals',
        name: 'Rentals',
        icon: 'IconCarFrontView',
        description: 'Car rental and mobility gift cards.',
        sortOrder: 12,
    },
    {
        slug: 'streaming',
        name: 'Streaming',
        icon: 'IconClapboardWide',
        description: 'Video and entertainment streaming subscriptions.',
        sortOrder: 13,
    },
];

const REDEEM_HTML =
    '<p>Complete checkout, then open your order confirmation email. Copy the code and redeem it in the brand’s official app or website within the validity window shown on the card.</p>';

const WARRANTY_HTML =
    '<p>Codes are guaranteed at the time of delivery. If a code fails to redeem, contact support within 7 days with your order ID for a replacement or refund per store policy.</p>';

const PRODUCT_DEFS: ProductSeedDef[] = [
    {
        slug: 'speedway-giftcards',
        name: 'Speedway Giftcards',
        categorySlug: 'gas-oil',
        description:
            'Prepaid Speedway gift cards for fuel and convenience-store purchases at participating Speedway locations.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 1,
        shortNotice:
            'Use at the pump or in-store at participating Speedway locations.',
        deliveryContent:
            'Digital delivery includes the gift card number and PIN. Present at checkout or load it into the Speedway app.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: null,
    },
    {
        slug: 'southwest-airlines',
        name: 'Southwest',
        categorySlug: 'flights',
        description:
            'Southwest Airlines gift cards toward flights, fares, and travel on Southwest with no change fees.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 2,
        shortNotice: 'Apply toward Southwest flight bookings at southwest.com.',
        deliveryContent:
            'Digital delivery includes the gift card number and security code. Redeem during checkout at southwest.com.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: null,
    },
    {
        slug: 'ihg',
        name: 'IHG',
        categorySlug: 'hotels',
        description:
            'IHG Hotels & Resorts gift cards for stays across InterContinental, Holiday Inn, and other IHG brands worldwide.',
        isHot: false,
        isNew: true,
        isRestocked: false,
        sortOrder: 3,
        shortNotice: 'Redeemable for stays at participating IHG hotels.',
        deliveryContent:
            'Digital delivery includes the gift card number and PIN. Apply at booking or at the front desk of participating IHG hotels.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United Kingdom',
        launchedAt: null,
        restockedAt: null,
    },
    {
        slug: 'british-airways',
        name: 'British Airways',
        categorySlug: 'flights',
        description:
            'British Airways gift cards toward flights and Avios bookings on britishairways.com.',
        isHot: false,
        isNew: true,
        isRestocked: false,
        sortOrder: 4,
        shortNotice:
            'Apply toward British Airways flights at britishairways.com.',
        deliveryContent:
            'Digital delivery includes the gift card reference and PIN. Redeem when booking flights on britishairways.com.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United Kingdom',
        launchedAt: null,
        restockedAt: null,
    },
    {
        slug: 'pc-optimum',
        name: 'PC Optimum',
        categorySlug: 'groceries',
        description:
            'PC Optimum gift cards and points for groceries and everyday essentials across Loblaws-family stores in Canada (pcid.ca).',
        isHot: false,
        isNew: false,
        isRestocked: true,
        sortOrder: 5,
        shortNotice:
            'Use at participating Loblaws-family stores; manage your account at pcid.ca.',
        deliveryContent:
            'Digital delivery includes the card number and PIN. Add it to your PC Optimum account at pcid.ca or present in-store.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'Canada',
        launchedAt: null,
        restockedAt: null,
    },
    {
        slug: 'harveys',
        name: "Harvey's",
        categorySlug: 'food',
        description:
            "Harvey's gift cards for burgers, combos, and meals at Harvey's restaurants across Canada.",
        isHot: false,
        isNew: false,
        isRestocked: false,
        sortOrder: 6,
        shortNotice:
            "Redeemable in-store at participating Harvey's locations in Canada.",
        deliveryContent:
            "Digital delivery includes the gift card number and PIN. Present at checkout at participating Harvey's restaurants.",
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'Canada',
        launchedAt: null,
        restockedAt: null,
    },
];

const VARIANT_DENOMS = [
    { label: '$1', price: '1.00', sortOrder: 0 },
    { label: '$3', price: '3.00', sortOrder: 1 },
    { label: '$5', price: '5.00', sortOrder: 2 },
] as const;

const STOCK_LINES_PER_VARIANT = 20;

type StockFormat = 'credentials' | 'code';

const STREAMING_CATEGORY: CategorySlug = 'streaming';

function pickStockFormat(categorySlug: CategorySlug): StockFormat {
    return categorySlug === STREAMING_CATEGORY ? 'credentials' : 'code';
}

function randomFromCharset(length: number, charset: string): string {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += charset[bytes[i] % charset.length];
    }
    return out;
}

function generateStockLineContent(format: StockFormat): string {
    if (format === 'credentials') {
        const userChars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const passChars =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const localPart = randomFromCharset(8, userChars);
        const password = randomFromCharset(12, passChars);
        return `${localPart}@example.com:${password}`;
    }
    // 16-char hyphenated redemption code: XXXX-XXXX-XXXX-XXXX
    const codeChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return [0, 0, 0, 0].map(() => randomFromCharset(4, codeChars)).join('-');
}

function generateUniqueStockLines(
    format: StockFormat,
    count: number
): string[] {
    const set = new Set<string>();
    // Defensive cap to prevent runaway loops if entropy is somehow exhausted.
    let safety = count * 10;
    while (set.size < count && safety-- > 0) {
        set.add(generateStockLineContent(format));
    }
    return Array.from(set);
}

@Injectable()
export class ProductsSeedService {
    constructor(
        private readonly logger: PinoLogger,
        private readonly databaseService: DatabaseService
    ) {
        this.logger.setContext(ProductsSeedService.name);
    }

    @Command({
        command: 'seed:products',
        describe:
            'Seed product categories and products for testing payment flow',
    })
    async seed(): Promise<void> {
        this.logger.info('Starting product seeding...');

        try {
            const categories = await this.createCategories();
            this.logger.info(
                `Ensured ${Object.keys(categories).length} categories`
            );

            const products = await this.createProducts(categories);
            this.logger.info(`Ensured ${products.length} products`);

            this.logger.info('Product seeding completed successfully');
        } catch (error) {
            this.logger.error(`Error seeding products: ${error.message}`);
            throw error;
        }
    }

    private async createCategories(): Promise<
        Record<CategorySlug, ProductCategory>
    > {
        const map = {} as Record<CategorySlug, ProductCategory>;

        for (const row of CATEGORY_SEEDS) {
            const existing =
                await this.databaseService.productCategory.findUnique({
                    where: { slug: row.slug },
                });

            if (existing) {
                this.logger.info(`Category ${row.slug} already exists`);
                map[row.slug] = existing;
            } else {
                const created =
                    await this.databaseService.productCategory.create({
                        data: {
                            name: row.name,
                            slug: row.slug,
                            description: row.description,
                            icon: row.icon,
                            sortOrder: row.sortOrder,
                        },
                    });
                map[row.slug] = created;
                this.logger.info(`Created category: ${row.name}`);
            }
        }

        return map;
    }

    private async createProducts(
        categories: Record<CategorySlug, ProductCategory>
    ): Promise<Product[]> {
        const products: Product[] = [];

        for (const def of PRODUCT_DEFS) {
            const existing = await this.databaseService.product.findUnique({
                where: { slug: def.slug },
            });

            if (existing) {
                this.logger.info(`Product ${def.slug} already exists`);
                products.push(existing);
                await this.topUpVariantStockLines(
                    existing.id,
                    def.categorySlug
                );
                continue;
            }

            const category = categories[def.categorySlug];
            const basePrice = VARIANT_DENOMS[0].price;

            const totalStock = STOCK_LINES_PER_VARIANT * VARIANT_DENOMS.length;

            const product = await this.databaseService.product.create({
                data: {
                    name: def.name,
                    slug: def.slug,
                    description: def.description,
                    price: new Prisma.Decimal(basePrice),
                    stockQuantity: totalStock,
                    categoryId: category.id,
                    deliveryType: DeliveryType.INSTANT,
                    deliveryContent: def.deliveryContent,
                    sortOrder: def.sortOrder,
                    shortNotice: def.shortNotice,
                    flair: def.flair ?? null,
                    isHot: def.isHot,
                    isNew: def.isNew,
                    isNFA: false,
                    isRestocked: def.isRestocked,
                    launchedAt: def.launchedAt,
                    restockedAt: def.restockedAt,
                    redeemProcess: def.redeemProcess,
                    warrantyText: def.warrantyText,
                    countryOfOrigin: def.countryOfOrigin,
                    variants: {
                        create: VARIANT_DENOMS.map(v => ({
                            label: v.label,
                            price: new Prisma.Decimal(v.price),
                            stockQuantity: STOCK_LINES_PER_VARIANT,
                            sortOrder: v.sortOrder,
                        })),
                    },
                },
                include: { variants: true },
            });

            const format = pickStockFormat(def.categorySlug);
            for (const variant of product.variants) {
                const lines = generateUniqueStockLines(
                    format,
                    STOCK_LINES_PER_VARIANT
                );
                await this.databaseService.productStockLine.createMany({
                    data: lines.map(content => ({
                        variantId: variant.id,
                        content,
                        contentHash: hashStockLineContent(content),
                        status: StockLineStatus.AVAILABLE,
                    })),
                    skipDuplicates: true,
                });
            }

            products.push(product);
            this.logger.info(
                `Created product: ${def.name} (+${totalStock} stock lines)`
            );
        }

        return products;
    }

    /**
     * Backfills missing AVAILABLE stock lines for an already-seeded product
     * up to STOCK_LINES_PER_VARIANT per variant. Lets `yarn seed:products` be
     * re-run to repair products that were originally seeded with bogus counters
     * and zero actual stock-line rows.
     */
    private async topUpVariantStockLines(
        productId: string,
        categorySlug: CategorySlug
    ): Promise<void> {
        const variants = await this.databaseService.productVariant.findMany({
            where: { productId, deletedAt: null },
        });
        const format = pickStockFormat(categorySlug);

        for (const variant of variants) {
            const existingCount =
                await this.databaseService.productStockLine.count({
                    where: { variantId: variant.id },
                });
            if (existingCount >= STOCK_LINES_PER_VARIANT) continue;

            const needed = STOCK_LINES_PER_VARIANT - existingCount;
            const lines = generateUniqueStockLines(format, needed);
            await this.databaseService.productStockLine.createMany({
                data: lines.map(content => ({
                    variantId: variant.id,
                    content,
                    contentHash: hashStockLineContent(content),
                    status: StockLineStatus.AVAILABLE,
                })),
                skipDuplicates: true,
            });

            const availableCount =
                await this.databaseService.productStockLine.count({
                    where: {
                        variantId: variant.id,
                        status: StockLineStatus.AVAILABLE,
                    },
                });
            await this.databaseService.productVariant.update({
                where: { id: variant.id },
                data: { stockQuantity: availableCount },
            });
        }
    }
}
