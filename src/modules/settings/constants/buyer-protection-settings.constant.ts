// Admin-configurable content + pricing for the checkout "Buyer Protection"
// step. Unlike the payment settings (one key per field), the whole config is
// stored as a single JSON row in `SystemSettings` (key `buyer_protection`,
// category `buyer-protection`) because the feature bullet lists are
// variable-length arrays. The defaults below mirror the previously hardcoded
// storefront panel, so the UI is unchanged until an admin edits it.

export const BUYER_PROTECTION_SETTINGS_CATEGORY = 'buyer-protection';
export const BUYER_PROTECTION_SETTINGS_KEY = 'buyer_protection';

export type BuyerProtectionPriceMode = 'fixed' | 'percent';

export interface BuyerProtectionPlanConfig {
    title: string;
    badge: string;
    icon: string;
    // 'fixed' charges `priceUsd`; 'percent' charges `pricePercent`% of the
    // order subtotal. Both values are stored so toggling the mode preserves the
    // other one.
    priceMode: BuyerProtectionPriceMode;
    priceUsd: number;
    pricePercent: number;
    benefits: string[];
}

export interface BuyerProtectionBasicPlanConfig {
    title: string;
    icon: string;
    benefits: string[];
}

export interface BuyerProtectionConfig {
    enabled: boolean;
    heading: string;
    subheading: string;
    footerText: string;
    enhanced: BuyerProtectionPlanConfig;
    basic: BuyerProtectionBasicPlanConfig;
}

export const DEFAULT_BUYER_PROTECTION: BuyerProtectionConfig = {
    enabled: true,
    heading: 'BUYER PROTECTION',
    subheading: 'Secure your checkout',
    footerText: 'Protected by Jinx Buyer Protection',
    enhanced: {
        title: 'Enhanced Protection',
        badge: 'Most Popular',
        icon: 'IconShieldCheck',
        priceMode: 'fixed',
        priceUsd: 5,
        pricePercent: 5,
        benefits: [
            'Full reimbursement or instant replacement for failed or missing deliveries',
            'Protection against inactive or compromised account issues',
            'Real-time tracking support for missing or delayed links',
            '24/7 priority assistance with fast-track resolution options',
        ],
    },
    basic: {
        title: 'Basic Coverage',
        icon: 'IconSupport',
        benefits: [
            'No reimbursement or replacement coverage guaranteed',
            'Limited support availability',
            'No expedited resolution services',
            'Standard assistance only',
        ],
    },
};
