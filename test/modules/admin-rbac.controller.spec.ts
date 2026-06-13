import 'reflect-metadata';

import { Role } from '@prisma/client';

jest.mock('src/modules/crypto-payment/services/crypto-payment.service', () => ({
    CryptoPaymentService: class CryptoPaymentService {},
}));
jest.mock(
    'src/modules/crypto-payment/services/blockchain-monitor.service',
    () => ({
        BlockchainMonitorService: class BlockchainMonitorService {},
    })
);
jest.mock(
    'src/modules/crypto-payment/services/payment-forwarding.service',
    () => ({
        PaymentForwardingService: class PaymentForwardingService {},
    })
);
jest.mock('src/modules/crypto-payment/services/system-wallet.service', () => ({
    SystemWalletService: class SystemWalletService {},
}));

import { ROLES_DECORATOR_KEY } from 'src/common/request/constants/request.constant';
import {
    FINANCIAL_OPS_ROLES,
    PRODUCT_CREATE_ROLES,
    READ_ADMIN_ROLES,
    STAFF_OPERATIONS_ROLES,
    STOCK_CONTRIBUTOR_ROLES,
    SUPPORT_HANDLING_ROLES,
} from 'src/common/request/constants/roles.constant';
import { ActivityLogAdminController } from 'src/modules/activity-log/controllers/activity-log.admin.controller';
import { CouponAdminController } from 'src/modules/coupon/controllers/coupon.admin.controller';
import { CryptoPaymentAdminController } from 'src/modules/crypto-payment/controllers/crypto-payment.admin.controller';
import { DropAdminController } from 'src/modules/drop/controllers/drop.admin.controller';
import { OrderAdminController } from 'src/modules/order/controllers/order.admin.controller';
import { ProductAdminController } from 'src/modules/product/controllers/product.admin.controller';
import { ReviewAdminController } from 'src/modules/review/controllers/review.admin.controller';
import { VouchAdminController } from 'src/modules/vouch/controllers/vouch.admin.controller';
import { StockLineAdminController } from 'src/modules/stock-line/controllers/stock-line.admin.controller';
import { TicketAdminController } from 'src/modules/ticket/controllers/ticket.admin.controller';
import { UserAdminController } from 'src/modules/user/controllers/user.admin.controller';
import { UserTeamController } from 'src/modules/user/controllers/user.team.controller';
import { WalletAdminController } from 'src/modules/wallet/controllers/wallet.admin.controller';

type ControllerClass = { prototype: Record<string, unknown> };

const OWNER_ONLY_ROLES = [Role.OWNER];
const STAFF_ROLES = [
    Role.OWNER,
    Role.MOD,
    Role.ALLIANCE,
    Role.SUPPORT,
    Role.SUPER_ADMIN,
];

function allowedRolesFor(
    controller: ControllerClass,
    methodName: string
): Role[] | undefined {
    return Reflect.getMetadata(
        ROLES_DECORATOR_KEY,
        controller.prototype[methodName] as object
    );
}

function expectMethodRoles(
    controller: ControllerClass,
    methodName: string,
    expectedRoles: Role[]
) {
    expect(allowedRolesFor(controller, methodName)).toEqual(expectedRoles);
}

function canAccess(role: Role, requiredRoles: Role[]): boolean {
    return role === Role.SUPER_ADMIN || requiredRoles.includes(role);
}

function expectRoleMatrix(
    controller: ControllerClass,
    methodName: string,
    expectedAllowedRoles: Role[]
) {
    const requiredRoles = allowedRolesFor(controller, methodName);

    expect(requiredRoles).toEqual(expectedAllowedRoles);
    for (const role of STAFF_ROLES) {
        expect(canAccess(role, requiredRoles ?? [])).toBe(
            role === Role.SUPER_ADMIN || expectedAllowedRoles.includes(role)
        );
    }
}

describe('Admin RBAC controller metadata', () => {
    describe('ProductAdminController', () => {
        it('allows staff reads and owner/mod mutations', () => {
            for (const methodName of [
                'list',
                'search',
                'listCategories',
                'getCategoryById',
                'getById',
            ]) {
                expectMethodRoles(
                    ProductAdminController,
                    methodName,
                    READ_ADMIN_ROLES
                );
            }

            for (const methodName of [
                'createCategory',
                'updateCategory',
                'deleteCategory',
                'toggleCategoryActive',
            ]) {
                expectMethodRoles(
                    ProductAdminController,
                    methodName,
                    STAFF_OPERATIONS_ROLES
                );
            }

            // Product create/mutations are open to Alliance (ownership enforced
            // in the service), so they use the wider PRODUCT_CREATE_ROLES set.
            for (const methodName of [
                'create',
                'addVariant',
                'updateVariant',
                'deleteVariant',
                'update',
                'delete',
                'updateStock',
                'toggleActive',
                'addImage',
                'removeImage',
                'setPrimaryImage',
            ]) {
                expectMethodRoles(
                    ProductAdminController,
                    methodName,
                    PRODUCT_CREATE_ROLES
                );
            }
        });
    });

    describe('StockLineAdminController', () => {
        it('allows alliance stock contribution but reserves deletes for owner/mod', () => {
            for (const methodName of [
                'bulkAddLines',
                'listLines',
                'getSummary',
            ]) {
                expectMethodRoles(
                    StockLineAdminController,
                    methodName,
                    STOCK_CONTRIBUTOR_ROLES
                );
            }

            for (const methodName of ['deleteLine', 'clearOrReject']) {
                expectMethodRoles(
                    StockLineAdminController,
                    methodName,
                    STAFF_OPERATIONS_ROLES
                );
            }
        });
    });

    describe('OrderAdminController', () => {
        it('matches read, operations, and refund role sets', () => {
            expectMethodRoles(
                OrderAdminController,
                'getAllOrders',
                READ_ADMIN_ROLES
            );
            expectMethodRoles(
                OrderAdminController,
                'getOrderDetail',
                READ_ADMIN_ROLES
            );
            expectMethodRoles(
                OrderAdminController,
                'updateOrderStatus',
                STAFF_OPERATIONS_ROLES
            );
            expectMethodRoles(
                OrderAdminController,
                'deliverOrder',
                STAFF_OPERATIONS_ROLES
            );
            expectMethodRoles(
                OrderAdminController,
                'refundOrder',
                SUPPORT_HANDLING_ROLES
            );
        });
    });

    describe('TicketAdminController', () => {
        it('limits every ticket handler to support-capable roles', () => {
            for (const methodName of [
                'listTickets',
                'getMessages',
                'getTicketDetail',
                'sendStaffMessage',
                'presignAttachment',
                'updateTicket',
                'markRead',
                'closeTicket',
            ]) {
                expectMethodRoles(
                    TicketAdminController,
                    methodName,
                    SUPPORT_HANDLING_ROLES
                );
            }
        });
    });

    describe('WalletAdminController', () => {
        it('allows wallet reads to operations staff and balance changes to owner', () => {
            expectMethodRoles(
                WalletAdminController,
                'getUserWallet',
                STAFF_OPERATIONS_ROLES
            );
            expectMethodRoles(
                WalletAdminController,
                'getUserTransactionHistory',
                STAFF_OPERATIONS_ROLES
            );
            expectMethodRoles(
                WalletAdminController,
                'addBalance',
                FINANCIAL_OPS_ROLES
            );
            expectMethodRoles(
                WalletAdminController,
                'adjustBalance',
                FINANCIAL_OPS_ROLES
            );
        });
    });

    describe('Core admin controllers', () => {
        it('applies read versus mutation gates for coupons, drops, users, and reviews', () => {
            for (const methodName of ['list', 'getById']) {
                expectMethodRoles(
                    CouponAdminController,
                    methodName,
                    READ_ADMIN_ROLES
                );
                expectMethodRoles(
                    DropAdminController,
                    methodName,
                    READ_ADMIN_ROLES
                );
            }

            for (const methodName of [
                'create',
                'toggleActive',
                'update',
                'delete',
            ]) {
                expectMethodRoles(
                    CouponAdminController,
                    methodName,
                    STAFF_OPERATIONS_ROLES
                );
                expectMethodRoles(
                    DropAdminController,
                    methodName,
                    STAFF_OPERATIONS_ROLES
                );
            }

            for (const methodName of ['listUsers', 'getUserStats', 'getUser']) {
                expectMethodRoles(
                    UserAdminController,
                    methodName,
                    READ_ADMIN_ROLES
                );
            }

            for (const methodName of [
                'flagUser',
                'unflagUser',
                'banUser',
                'unbanUser',
                'deleteUser',
            ]) {
                expectMethodRoles(
                    UserAdminController,
                    methodName,
                    STAFF_OPERATIONS_ROLES
                );
            }

            expectMethodRoles(ReviewAdminController, 'list', READ_ADMIN_ROLES);
            expectMethodRoles(
                ReviewAdminController,
                'delete',
                STAFF_OPERATIONS_ROLES
            );

            expectMethodRoles(VouchAdminController, 'list', READ_ADMIN_ROLES);
            expectMethodRoles(
                VouchAdminController,
                'approve',
                STAFF_OPERATIONS_ROLES
            );
            expectMethodRoles(
                VouchAdminController,
                'delete',
                STAFF_OPERATIONS_ROLES
            );
        });

        it('keeps activity logs and team management owner-only', () => {
            for (const methodName of ['list', 'export', 'actors', 'getById']) {
                expectMethodRoles(
                    ActivityLogAdminController,
                    methodName,
                    OWNER_ONLY_ROLES
                );
            }

            for (const methodName of [
                'listTeamMembers',
                'inviteTeamMember',
                'updateTeamMember',
                'resendInvite',
                'removeTeamMember',
            ]) {
                expectMethodRoles(
                    UserTeamController,
                    methodName,
                    OWNER_ONLY_ROLES
                );
            }
        });

        it('keeps crypto payment operations on operations and financial role sets', () => {
            expectMethodRoles(
                CryptoPaymentAdminController,
                'getAllPayments',
                STAFF_OPERATIONS_ROLES
            );
            expectMethodRoles(
                CryptoPaymentAdminController,
                'getPaymentDetail',
                STAFF_OPERATIONS_ROLES
            );

            for (const methodName of [
                'verifyPayment',
                'forwardPayment',
                'getWalletIndexes',
            ]) {
                expectMethodRoles(
                    CryptoPaymentAdminController,
                    methodName,
                    FINANCIAL_OPS_ROLES
                );
            }
        });
    });

    describe('Representative role matrix', () => {
        it('allows owner everywhere and super admin through the guard bypass', () => {
            for (const [controller, methodName, expectedRoles] of [
                [ProductAdminController, 'create', PRODUCT_CREATE_ROLES],
                [OrderAdminController, 'refundOrder', SUPPORT_HANDLING_ROLES],
                [WalletAdminController, 'addBalance', FINANCIAL_OPS_ROLES],
                [ActivityLogAdminController, 'list', OWNER_ONLY_ROLES],
            ] as Array<[ControllerClass, string, Role[]]>) {
                expectRoleMatrix(controller, methodName, expectedRoles);
            }
        });

        it('captures mod, support, and alliance allow/deny expectations', () => {
            expect(canAccess(Role.MOD, STAFF_OPERATIONS_ROLES)).toBe(true);
            expect(canAccess(Role.MOD, SUPPORT_HANDLING_ROLES)).toBe(true);
            expect(canAccess(Role.MOD, FINANCIAL_OPS_ROLES)).toBe(false);
            expect(canAccess(Role.MOD, OWNER_ONLY_ROLES)).toBe(false);

            expect(canAccess(Role.SUPPORT, SUPPORT_HANDLING_ROLES)).toBe(true);
            expect(canAccess(Role.SUPPORT, STAFF_OPERATIONS_ROLES)).toBe(false);
            expect(canAccess(Role.SUPPORT, STOCK_CONTRIBUTOR_ROLES)).toBe(
                false
            );

            expect(canAccess(Role.ALLIANCE, READ_ADMIN_ROLES)).toBe(true);
            expect(canAccess(Role.ALLIANCE, STOCK_CONTRIBUTOR_ROLES)).toBe(
                true
            );
            expect(canAccess(Role.ALLIANCE, STAFF_OPERATIONS_ROLES)).toBe(
                false
            );
            expect(canAccess(Role.ALLIANCE, SUPPORT_HANDLING_ROLES)).toBe(
                false
            );
        });
    });
});
