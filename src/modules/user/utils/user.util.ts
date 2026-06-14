/**
 * User utility functions
 */
import {
    generateReferenceCode,
    generateUniqueReferenceCode,
    REFERENCE_PREFIX,
} from '../../../common/utils/reference-code.util';
import { DatabaseService } from 'src/common/database/services/database.service';

/** Compact user number, e.g. JINX-USR-738291045 */
export function generateUserNumberString(): string {
    return generateReferenceCode(REFERENCE_PREFIX.USER);
}

/**
 * Generate a user number that is guaranteed unique against the `users` table,
 * retrying on the (very unlikely) collision.
 */
export function generateUniqueUserNumber(
    databaseService: DatabaseService
): Promise<string> {
    return generateUniqueReferenceCode(
        REFERENCE_PREFIX.USER,
        async code =>
            !!(await databaseService.user.findUnique({
                where: { userNumber: code },
                select: { id: true },
            }))
    );
}
