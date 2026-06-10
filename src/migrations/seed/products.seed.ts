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
    | 'visa-gift-card'
    | 'mastercard-gift-card'
    | 'paypal'
    | 'venmo'
    | 'marriott-bonvoy'
    | 'hilton-honors'
    | 'starbucks'
    | 'doordash'
    | 'southwest-airlines'
    | 'delta-air-lines'
    | 'whole-foods-market'
    | 'instacart'
    | 'amazon'
    | 'target'
    | 'nike'
    | 'gap'
    | 'shell-fuel-card'
    | 'exxonmobil-gift-card'
    | 'ticketmaster'
    | 'stubhub'
    | 'spotify-premium'
    | 'google-play'
    | 'pandora'
    | 'tiffany-co'
    | 'hertz'
    | 'enterprise'
    | 'netflix'
    | 'disney-plus';

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
    iconUrl?: string;
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
        slug: 'visa-gift-card',
        name: 'Visa Gift Card',
        categorySlug: 'cashout',
        description:
            'Prepaid Visa accepted almost everywhere debit is taken — online, in-store, and on the go.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 1,
        shortNotice: 'Spend like cash wherever Visa debit is accepted.',
        deliveryContent:
            'Digital delivery includes card number, expiration, and security code. Register the card on the issuer site if required before first use.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-16T10:00:00.000Z'),
    },
    {
        slug: 'mastercard-gift-card',
        name: 'Mastercard Gift Card',
        categorySlug: 'cashout',
        description:
            'Mastercard prepaid for flexible spending across millions of merchants worldwide.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 2,
        shortNotice: 'One card for shopping, dining, and bills where accepted.',
        deliveryContent:
            'Follow the activation link in your email, then add the card to mobile wallets or use online at checkout.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-16T11:00:00.000Z'),
    },
    {
        slug: 'paypal',
        name: 'PayPal',
        categorySlug: 'cashout',
        description:
            'Add funds to PayPal for peer transfers, checkout, or moving money to your bank.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 3,
        shortNotice: 'Top up your PayPal balance for instant spending power.',
        deliveryContent:
            'Redeem in the PayPal app or web under Wallet → Link a card or bank → Redeem gift card / add funds per regional flow.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-16T12:00:00.000Z'),
    },
    {
        slug: 'venmo',
        name: 'Venmo',
        categorySlug: 'cashout',
        description:
            'Venmo balance for paying friends, splitting bills, or cashing out to a linked debit card.',
        isHot: false,
        isNew: true,
        isRestocked: true,
        sortOrder: 4,
        shortNotice: 'Credit applies to your Venmo balance after redemption.',
        deliveryContent:
            'Open Venmo → ☰ → Settings → Payment Methods → Redeem a gift card, then enter the code from your order email.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: new Date('2026-04-12T10:00:00.000Z'),
        restockedAt: new Date('2026-04-14T16:00:00.000Z'),
    },
    {
        slug: 'marriott-bonvoy',
        name: 'Marriott Bonvoy',
        categorySlug: 'hotels',
        description:
            'Marriott Bonvoy gift card toward stays, dining, and spa services at participating Marriott properties.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 5,
        shortNotice: 'Use at checkout for eligible Marriott hotels.',
        deliveryContent:
            'Present the gift card number at the front desk or apply it when booking on marriott.com where accepted.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-15T08:00:00.000Z'),
    },
    {
        slug: 'hilton-honors',
        name: 'Hilton Honors',
        categorySlug: 'hotels',
        description:
            'Hilton gift card for room nights, upgrades, and on-property dining at Hilton brands.',
        isHot: false,
        isNew: true,
        isRestocked: false,
        sortOrder: 6,
        shortNotice: 'Redeem toward stays at participating Hilton hotels.',
        deliveryContent:
            'Add the card in the Hilton Honors app under Account → Payment Methods, or provide details at check-in.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: new Date('2026-04-11T10:00:00.000Z'),
        restockedAt: null,
    },
    {
        slug: 'starbucks',
        name: 'Starbucks',
        categorySlug: 'food',
        description:
            'Reload your Starbucks Card for drinks, food, and merchandise at participating stores.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 7,
        shortNotice: 'Scan in the Starbucks app or pay in-store.',
        deliveryContent:
            'Add the card number and security code in the Starbucks mobile app under Pay.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-15T09:00:00.000Z'),
    },
    {
        slug: 'doordash',
        name: 'DoorDash',
        categorySlug: 'food',
        description:
            'DoorDash credit for delivery and pickup from local restaurants and stores.',
        isHot: false,
        isNew: true,
        isRestocked: false,
        sortOrder: 8,
        shortNotice: 'Valid for eligible DoorDash orders in your region.',
        deliveryContent:
            'In the DoorDash app: Account → Gift Card → enter the code from your email.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: new Date('2026-04-10T10:00:00.000Z'),
        restockedAt: null,
    },
    {
        slug: 'southwest-airlines',
        name: 'Southwest Airlines',
        categorySlug: 'flights',
        description:
            'Southwest gift card toward flights, EarlyBird Check-In, and more on southwest.com.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 9,
        shortNotice: 'Apply at checkout when booking Southwest flights.',
        deliveryContent:
            'On southwest.com, enter the card number and PIN in the payment section before completing purchase.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-15T10:00:00.000Z'),
    },
    {
        slug: 'delta-air-lines',
        name: 'Delta Air Lines',
        categorySlug: 'flights',
        description:
            'Delta Gift Card for tickets, seat upgrades, and fees on delta.com and the Fly Delta app.',
        isHot: false,
        isNew: true,
        isRestocked: false,
        sortOrder: 10,
        shortNotice: 'Redeem when paying for Delta-operated flights.',
        deliveryContent:
            'At checkout on delta.com, choose Gift Card as payment and enter the certificate number and PIN.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: new Date('2026-04-09T10:00:00.000Z'),
        restockedAt: null,
    },
    {
        slug: 'whole-foods-market',
        name: 'Whole Foods Market',
        categorySlug: 'groceries',
        description:
            'Whole Foods Market gift card for organic groceries, prepared foods, and more.',
        isHot: false,
        isNew: true,
        isRestocked: false,
        sortOrder: 11,
        shortNotice: 'Use at Whole Foods registers and select Amazon retail.',
        deliveryContent:
            'Scan the barcode from your email at checkout or add to the Amazon app for in-store payment where supported.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: new Date('2026-04-08T10:00:00.000Z'),
        restockedAt: null,
    },
    {
        slug: 'instacart',
        name: 'Instacart',
        categorySlug: 'groceries',
        description:
            'Instacart credit for same-day grocery delivery from local stores.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 12,
        shortNotice: 'Applies to orders placed through Instacart.',
        deliveryContent:
            'Instacart app → Account → Your account settings → Gift cards → Add gift card.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-15T12:00:00.000Z'),
    },
    {
        slug: 'amazon',
        name: 'Amazon',
        categorySlug: 'shopping',
        description:
            'Amazon.com balance for millions of products, Kindle books, and digital content.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 13,
        shortNotice: 'Applies to your Amazon account balance at checkout.',
        deliveryContent:
            'Redeem at amazon.com/gc/redeem — funds never expire for US accounts.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-15T11:00:00.000Z'),
    },
    {
        slug: 'target',
        name: 'Target',
        categorySlug: 'shopping',
        description:
            'Target GiftCard for electronics, home, apparel, and everyday essentials in-store or online.',
        isHot: false,
        isNew: true,
        isRestocked: true,
        sortOrder: 14,
        shortNotice: 'Redeem at Target stores or on target.com.',
        deliveryContent:
            'Target app → Wallet → Add gift card, or enter the access number at checkout online.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: new Date('2026-04-07T10:00:00.000Z'),
        restockedAt: new Date('2026-04-13T10:00:00.000Z'),
    },
    {
        slug: 'nike',
        name: 'Nike',
        categorySlug: 'clothing',
        description:
            'Nike gift card for sneakers, apparel, and gear on Nike.com and at Nike stores.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 15,
        shortNotice: 'Works for Nike.com, SNKRS, and participating retail.',
        deliveryContent:
            'Nike App → Profile → Settings → Payment → Add gift card, or enter at checkout on Nike.com.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-16T13:00:00.000Z'),
    },
    {
        slug: 'gap',
        name: 'Gap',
        categorySlug: 'clothing',
        description:
            'Gap Options gift card redeemable at Gap, Banana Republic, Old Navy, and Athleta.',
        isHot: false,
        isNew: true,
        isRestocked: false,
        sortOrder: 16,
        shortNotice: 'One card across Gap Inc. family of brands.',
        deliveryContent:
            'Present in-store or apply the card number and PIN at checkout on any participating brand site.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: new Date('2026-04-06T10:00:00.000Z'),
        restockedAt: null,
    },
    {
        slug: 'shell-fuel-card',
        name: 'Shell Fuel Card',
        categorySlug: 'gas-oil',
        description:
            'Shell gift card for fuel, car washes, and convenience items at participating Shell stations.',
        isHot: false,
        isNew: false,
        isRestocked: true,
        sortOrder: 17,
        shortNotice: 'Swipe at the pump or inside at Shell locations.',
        deliveryContent:
            'Physical-style digital card: use the number at the pump keypad or pay inside where Shell cards are accepted.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-14T10:00:00.000Z'),
    },
    {
        slug: 'exxonmobil-gift-card',
        name: 'ExxonMobil Gift Card',
        categorySlug: 'gas-oil',
        description:
            'Exxon and Mobil gift card for fuel and in-store purchases at participating locations.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 18,
        shortNotice:
            'Accepted at Exxon and Mobil stations in supported regions.',
        deliveryContent:
            'Follow the issuer instructions in your email to activate before first use at the pump or cashier.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-16T14:00:00.000Z'),
    },
    {
        slug: 'ticketmaster',
        name: 'Ticketmaster',
        categorySlug: 'tickets',
        description:
            'Ticketmaster gift card for concerts, sports, theater, and live events.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 19,
        shortNotice: 'Apply at checkout on ticketmaster.com or the app.',
        deliveryContent:
            'Sign in to Ticketmaster → Payment options → Add a gift card, then use it when completing your order.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-15T14:00:00.000Z'),
    },
    {
        slug: 'stubhub',
        name: 'StubHub',
        categorySlug: 'tickets',
        description:
            'StubHub gift card toward resale tickets for games, shows, and festivals.',
        isHot: false,
        isNew: true,
        isRestocked: false,
        sortOrder: 20,
        shortNotice:
            'Valid on StubHub purchases where gift cards are accepted.',
        deliveryContent:
            'StubHub checkout → Add gift card → enter the code from your confirmation email.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: new Date('2026-04-05T10:00:00.000Z'),
        restockedAt: null,
    },
    {
        slug: 'spotify-premium',
        name: 'Spotify Premium',
        categorySlug: 'lifestyle',
        description:
            'Spotify Premium for ad-free music, podcasts, and offline listening on your phone.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 21,
        shortNotice: 'Premium listening without ads.',
        deliveryContent:
            'Redeem at spotify.com/redeem using the code from your order confirmation.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'Sweden',
        launchedAt: null,
        restockedAt: new Date('2026-04-15T09:00:00.000Z'),
    },
    {
        slug: 'google-play',
        name: 'Google Play',
        categorySlug: 'lifestyle',
        description:
            'Google Play credit for apps, games, books, and in-app purchases on Android.',
        isHot: false,
        isNew: true,
        isRestocked: true,
        sortOrder: 22,
        shortNotice: 'Adds balance to your Google Play account.',
        deliveryContent:
            'Play Store → Profile icon → Payments & subscriptions → Redeem gift code.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: new Date('2026-04-04T10:00:00.000Z'),
        restockedAt: new Date('2026-04-12T12:00:00.000Z'),
    },
    {
        slug: 'pandora',
        name: 'Pandora Jewelry',
        categorySlug: 'jewelry',
        description:
            'Pandora gift card for charms, bracelets, and jewelry collections.',
        isHot: false,
        isNew: true,
        isRestocked: false,
        sortOrder: 23,
        shortNotice: 'Redeem in Pandora stores and on pandora.net.',
        deliveryContent:
            'Enter the card number and PIN at checkout online or present in boutique locations.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'Denmark',
        launchedAt: new Date('2026-04-03T10:00:00.000Z'),
        restockedAt: null,
    },
    {
        slug: 'tiffany-co',
        name: 'Tiffany & Co.',
        categorySlug: 'jewelry',
        description:
            'Tiffany gift card toward jewelry, watches, and home designs.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 24,
        shortNotice: 'Use at Tiffany stores and tiffany.com.',
        deliveryContent:
            'Provide the gift card details at checkout in-store or online where Tiffany gift cards are accepted.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-16T09:00:00.000Z'),
    },
    {
        slug: 'hertz',
        name: 'Hertz',
        categorySlug: 'rentals',
        description:
            'Hertz gift card toward car rentals, add-ons, and insurance at participating locations.',
        isHot: false,
        isNew: false,
        isRestocked: true,
        sortOrder: 25,
        shortNotice: 'Apply when booking on hertz.com or at the counter.',
        deliveryContent:
            'Enter the certificate number when paying online or mention it at pickup per Hertz redemption rules.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-11T14:00:00.000Z'),
    },
    {
        slug: 'enterprise',
        name: 'Enterprise',
        categorySlug: 'rentals',
        description:
            'Enterprise Rent-A-Car gift certificate for daily and weekly rentals.',
        isHot: true,
        isNew: false,
        isRestocked: false,
        sortOrder: 26,
        shortNotice:
            'Valid at participating Enterprise neighborhood locations.',
        deliveryContent:
            'Book on enterprise.com and enter the voucher details in the payment step, or present at the rental counter.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: null,
    },
    {
        slug: 'netflix',
        name: 'Netflix',
        categorySlug: 'streaming',
        description:
            'Stream thousands of TV shows and movies. Apply balance toward any Netflix plan.',
        isHot: true,
        isNew: false,
        isRestocked: true,
        sortOrder: 27,
        flair: 'Hot Pick',
        shortNotice:
            'Apply to new or existing Netflix accounts in supported regions.',
        deliveryContent:
            'Redeem at netflix.com/redeem — enter the code and the value applies to your next bills.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: null,
        restockedAt: new Date('2026-04-15T08:00:00.000Z'),
    },
    {
        slug: 'disney-plus',
        name: 'Disney+',
        categorySlug: 'streaming',
        description:
            'Disney+ subscription credit for Marvel, Star Wars, Pixar, and National Geographic streaming.',
        isHot: true,
        isNew: true,
        isRestocked: true,
        sortOrder: 28,
        flair: 'New',
        shortNotice: 'Redeem toward Disney+ in supported countries.',
        deliveryContent:
            'Visit disneyplus.com/redeem (or regional equivalent), sign in, and enter the subscription code from your email.',
        redeemProcess: REDEEM_HTML,
        warrantyText: WARRANTY_HTML,
        countryOfOrigin: 'United States',
        launchedAt: new Date('2026-04-13T10:00:00.000Z'),
        restockedAt: new Date('2026-04-16T08:00:00.000Z'),
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
            const imageUrl = `https://picsum.photos/seed/${def.slug}/640/360`;
            const iconUrl =
                def.iconUrl ?? `https://picsum.photos/seed/${def.slug}/64/64`;
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
                    iconUrl,
                    isHot: def.isHot,
                    isNew: def.isNew,
                    isNFA: false,
                    isRestocked: def.isRestocked,
                    launchedAt: def.launchedAt,
                    restockedAt: def.restockedAt,
                    redeemProcess: def.redeemProcess,
                    warrantyText: def.warrantyText,
                    countryOfOrigin: def.countryOfOrigin,
                    images: {
                        create: [
                            {
                                key: imageUrl,
                                url: imageUrl,
                                isPrimary: true,
                                sortOrder: 0,
                            },
                        ],
                    },
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
