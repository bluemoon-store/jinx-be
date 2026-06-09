import {
    generateReferenceCode,
    REFERENCE_PREFIX,
} from '../../../common/utils/reference-code.util';

/** Compact ticket number, e.g. JINX-TKT-738291045 */
export function generateTicketNumberString(): string {
    return generateReferenceCode(REFERENCE_PREFIX.TICKET);
}
