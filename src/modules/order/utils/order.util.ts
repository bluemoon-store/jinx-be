/**
 * Order utility functions
 */
import {
    generateReferenceCode,
    REFERENCE_PREFIX,
} from '../../../common/utils/reference-code.util';

export const BUYER_PROTECTION_FEE_USD = 5;

/** Compact order number, e.g. JINX-ORD-738291045 */
export function generateOrderNumberString(): string {
    return generateReferenceCode(REFERENCE_PREFIX.ORDER);
}
