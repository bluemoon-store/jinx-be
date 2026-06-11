import { Role } from '@prisma/client';

/** Staff roles that may access all `/admin/*` APIs (not end-users). */
export const ADMIN_ROLES: Role[] = [
    Role.OWNER,
    Role.MOD,
    Role.ALLIANCE,
    Role.SUPPORT,
];

/** Product/order/user/coupon/drop mutations for core operations staff. */
export const STAFF_OPERATIONS_ROLES: Role[] = [Role.OWNER, Role.MOD];

/** Ticket and refund handling roles. */
export const SUPPORT_HANDLING_ROLES: Role[] = [
    Role.OWNER,
    Role.MOD,
    Role.SUPPORT,
];

/** Stock-line contributor roles (Alliance included for current iteration). */
export const STOCK_CONTRIBUTOR_ROLES: Role[] = [
    Role.OWNER,
    Role.MOD,
    Role.ALLIANCE,
];

/** Revenue/dashboard visibility (owner-only). */
export const REVENUE_VIEW_ROLES: Role[] = [Role.OWNER];

/** Wallet/balance operation roles (owner-only). */
export const FINANCIAL_OPS_ROLES: Role[] = [Role.OWNER];

/** Store settings access — owner-only (SUPER_ADMIN bypasses via RolesGuard). */
export const SETTINGS_ACCESS_ROLES: Role[] = [Role.OWNER];

/** Read-only alias for staff admin endpoints. */
export const READ_ADMIN_ROLES: Role[] = [...ADMIN_ROLES];

export function isSuperAdminRole(role: Role): boolean {
    return role === Role.SUPER_ADMIN;
}

export function isAdminStaffRole(role: Role): boolean {
    return ADMIN_ROLES.includes(role);
}

/** Super admin or any admin staff — for service-layer checks (e.g. delete user). */
export function isPrivilegedAdminRole(role: Role): boolean {
    return isSuperAdminRole(role) || isAdminStaffRole(role);
}
