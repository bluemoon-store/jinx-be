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

/** Roles allowed to create/manage products. Alliance manages only its own (ownership enforced in service). */
export const PRODUCT_CREATE_ROLES: Role[] = [
    Role.OWNER,
    Role.MOD,
    Role.ALLIANCE,
];

/** Ticket and refund handling roles. */
export const SUPPORT_HANDLING_ROLES: Role[] = [
    Role.OWNER,
    Role.MOD,
    Role.SUPPORT,
];

/**
 * Per-order-item operations (deliver, issue replacement). Alliance is included
 * but is additionally restricted at the service layer to items whose product
 * it created (see OrderService.assertCanActOnOrderItems).
 */
export const ITEM_OPERATIONS_ROLES: Role[] = [
    Role.OWNER,
    Role.MOD,
    Role.SUPPORT,
    Role.ALLIANCE,
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

/**
 * Account "bucket" for email-uniqueness. An email may have at most one live
 * CUSTOMER account (storefront end-user, role USER) and one live TEAM account
 * (any staff/admin role). Login/forgot-password are split by portal accordingly.
 */
export function isCustomerRole(role: Role): boolean {
    return role === Role.USER;
}

/** TEAM bucket: any staff/admin account (everything that is not a plain USER). */
export function isTeamRole(role: Role): boolean {
    return role !== Role.USER;
}
