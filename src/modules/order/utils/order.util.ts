/**
 * Order utility functions
 */
import {
    generateReferenceCode,
    REFERENCE_PREFIX,
} from '../../../common/utils/reference-code.util';

// Historical default Enhanced-protection fee. The charged fee is now
// admin-configurable and read at order creation via
// SettingsService.getBuyerProtectionFeeUsd(); this mirrors the default in
// DEFAULT_BUYER_PROTECTION (settings module) and is kept as a reference value.
export const BUYER_PROTECTION_FEE_USD = 5;

/** Compact order number, e.g. JINX-ORD-738291045 */
export function generateOrderNumberString(): string {
    return generateReferenceCode(REFERENCE_PREFIX.ORDER);
}
