import { InjectQueue } from '@nestjs/bull';
import { HttpStatus, Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bull';
import { PinoLogger } from 'nestjs-pino';
import { OrderStatus, Prisma, StockLineStatus } from '@prisma/client';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    IOrderConfirmedPayload,
    ISendEmailBasePayload,
} from 'src/common/helper/interfaces/email.interface';
import { HelperPaginationService } from 'src/common/helper/services/helper.pagination.service';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';
import { WalletService } from 'src/modules/wallet/services/wallet.service';
import { ActivityLogEmitterService } from 'src/modules/activity-log/services/activity-log.emitter.service';
import { TicketMessageService } from 'src/modules/ticket/services/ticket-message.service';
import { TicketService } from 'src/modules/ticket/services/ticket.service';

import { OrderCreateDto } from '../dtos/request/order.create.request';
import { OrderIssueCreditDto } from '../dtos/request/order.issue-credit.request';
import { OrderIssueReplacementDto } from '../dtos/request/order.issue-replacement.request';
import { OrderStatusUpdateDto } from '../dtos/request/order.status-update.request';
import {
    OrderResponseDto,
    OrderDetailResponseDto,
} from '../dtos/response/order.response';
import { IOrderService } from '../interfaces/order.service.interface';
import {
    calculateLineItemsTotals,
    getCommerceLineSubtotal,
} from 'src/common/utils/commerce.util';
import { CouponWithCategories } from 'src/modules/coupon/interfaces/coupon.interface';
import { CouponService } from 'src/modules/coupon/services/coupon.service';
import { calculateCouponDiscount } from 'src/modules/coupon/utils/coupon-discount.util';
import {
    BUYER_PROTECTION_FEE_USD,
    generateOrderNumberString,
} from '../utils/order.util';
import { OrderDeliveryService } from './order-delivery.service';
import { StockLineService } from 'src/modules/stock-line/services/stock-line.service';

@Injectable()
export class OrderService implements IOrderService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly paginationService: HelperPaginationService,
        private readonly deliveryService: OrderDeliveryService,
        private readonly walletService: WalletService,
        private readonly couponService: CouponService,
        private readonly activityLogEmitter: ActivityLogEmitterService,
        private readonly stockLineService: StockLineService,
        private readonly configService: ConfigService,
        private readonly ticketService: TicketService,
        private readonly ticketMessageService: TicketMessageService,
        @InjectQueue(APP_BULL_QUEUES.EMAIL)
        private readonly emailQueue: Queue,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(OrderService.name);
    }

    /**
     * Generate unique order number (format: ORD-YYYYMMDD-XXXXX)
     */
    async generateOrderNumber(): Promise<string> {
        const orderNumber = generateOrderNumberString();

        // Check if order number already exists (very unlikely but check anyway)
        const existing = await this.databaseService.order.findUnique({
            where: { orderNumber },
        });

        if (existing) {
            // Retry with new random string
            return this.generateOrderNumber();
        }

        return orderNumber;
    }

    /**
     * Validate cart and stock before creating order
     */
    private async validateCartForOrder(userId: string): Promise<void> {
        const cart = await this.databaseService.cart.findUnique({
            where: { userId },
            include: {
                items: {
                    include: {
                        product: true,
                    },
                },
            },
        });

        if (!cart || !cart.items || cart.items.length === 0) {
            throw new HttpException(
                'order.error.cartEmpty',
                HttpStatus.BAD_REQUEST
            );
        }

        // Validate each item
        for (const item of cart.items) {
            const product = item.product;

            if (!product) {
                throw new HttpException(
                    'order.error.productNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            if (!product.isActive) {
                throw new HttpException(
                    'order.error.productInactive',
                    HttpStatus.BAD_REQUEST
                );
            }

            if (item.variantId) {
                const variant =
                    await this.databaseService.productVariant.findFirst({
                        where: {
                            id: item.variantId,
                            productId: item.productId,
                            deletedAt: null,
                            isActive: true,
                        },
                    });

                if (!variant) {
                    throw new HttpException(
                        `order.error.variantInvalid: ${product.name}`,
                        HttpStatus.BAD_REQUEST
                    );
                }

                if (variant.stockQuantity === 0) {
                    throw new HttpException(
                        `order.error.outOfStock: ${product.name}`,
                        HttpStatus.BAD_REQUEST
                    );
                }

                if (variant.stockQuantity < item.quantity) {
                    throw new HttpException(
                        `order.error.insufficientStock: ${product.name}`,
                        HttpStatus.BAD_REQUEST
                    );
                }
            } else {
                if (product.stockQuantity === 0) {
                    throw new HttpException(
                        `order.error.outOfStock: ${product.name}`,
                        HttpStatus.BAD_REQUEST
                    );
                }

                if (product.stockQuantity < item.quantity) {
                    throw new HttpException(
                        `order.error.insufficientStock: ${product.name}`,
                        HttpStatus.BAD_REQUEST
                    );
                }
            }
        }
    }

    /**
     * Fetch an order with the full item/product/payment graph used by the
     * order response. Shared by createOrder and the reuse-pending-order path.
     */
    private async fetchCompleteOrder(
        orderId: string
    ): Promise<OrderResponseDto> {
        const completeOrder = await this.databaseService.order.findUnique({
            where: { id: orderId },
            include: {
                items: {
                    include: {
                        product: {
                            include: {
                                category: true,
                                images: {
                                    where: { deletedAt: null },
                                    orderBy: [
                                        { isPrimary: 'desc' },
                                        { sortOrder: 'asc' },
                                    ],
                                },
                            },
                        },
                        vouches: {
                            where: { deletedAt: null },
                            orderBy: { createdAt: 'desc' },
                        },
                    },
                },
                cryptoPayment: true,
            },
        });

        return completeOrder as unknown as OrderResponseDto;
    }

    /**
     * Create order from cart
     */
    async createOrder(
        userId: string,
        data: OrderCreateDto
    ): Promise<OrderResponseDto> {
        try {
            // Reuse an existing, still-fresh PENDING order instead of creating a
            // duplicate (and re-reserving stock) when the user retries or switches
            // payment method. Freshness = created within the stock-reservation
            // window, so its reservations are still valid.
            const reservationWindowMs =
                this.stockLineService
                    .getDefaultReservationDeadline()
                    .getTime() - Date.now();
            const existingPending = await this.databaseService.order.findFirst({
                where: {
                    userId,
                    status: OrderStatus.PENDING,
                    deletedAt: null,
                },
                orderBy: { createdAt: 'desc' },
            });
            if (
                existingPending &&
                existingPending.createdAt.getTime() >
                    Date.now() - reservationWindowMs
            ) {
                return this.fetchCompleteOrder(existingPending.id);
            }

            // Validate cart and stock
            await this.validateCartForOrder(userId);

            // Get cart with items
            const cart = await this.databaseService.cart.findUnique({
                where: { userId },
                include: {
                    items: {
                        include: {
                            product: {
                                include: {
                                    category: true,
                                    images: {
                                        where: { deletedAt: null },
                                        orderBy: [
                                            { isPrimary: 'desc' },
                                            { sortOrder: 'asc' },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            });

            if (!cart || !cart.items || cart.items.length === 0) {
                throw new HttpException(
                    'order.error.cartEmpty',
                    HttpStatus.BAD_REQUEST
                );
            }

            // Calculate totals (subtotal from cart line snapshots)
            const { totalAmount, currency } = calculateLineItemsTotals(
                cart.items
            );
            const subtotal = parseFloat(totalAmount);
            const buyerProtection = Boolean(data.buyerProtection);
            const buyerProtectionUsd = buyerProtection
                ? BUYER_PROTECTION_FEE_USD
                : 0;

            const couponCodeRaw = data.couponCode?.trim();
            let appliedCoupon: CouponWithCategories | null = null;
            let discountAmountNum = 0;

            if (couponCodeRaw) {
                // Always loads from DB + cart rules (not GET /validate cache); cache TTL on validate is irrelevant here.
                const cartCategoryIds = [
                    ...new Set(cart.items.map(i => i.product.categoryId)),
                ];
                appliedCoupon = await this.couponService.findActiveByCode(
                    couponCodeRaw,
                    cartCategoryIds
                );
                const lineItems = cart.items.map(ci => ({
                    categoryId: ci.product.categoryId,
                    lineSubtotal: getCommerceLineSubtotal(ci),
                }));
                discountAmountNum = calculateCouponDiscount(
                    {
                        discountType: appliedCoupon.discountType,
                        discountValue: appliedCoupon.discountValue,
                        categoryScope: appliedCoupon.categoryScope,
                        categoryIds: appliedCoupon.categories.map(
                            c => c.categoryId
                        ),
                    },
                    lineItems
                ).discountAmount;
            }

            const finalTotalUsd = Math.max(
                0,
                subtotal - discountAmountNum + buyerProtectionUsd
            );
            if (finalTotalUsd <= 0) {
                throw new HttpException(
                    'order.error.invalidTotal',
                    HttpStatus.BAD_REQUEST
                );
            }
            const totalAmountStr = finalTotalUsd.toFixed(8);
            const subtotalStr = subtotal.toFixed(8);
            const discountStr = discountAmountNum.toFixed(8);

            // Generate order number
            const orderNumber = await this.generateOrderNumber();

            // Create order and items in transaction
            const order = await this.databaseService.$transaction(async tx => {
                // Create order
                const newOrder = await tx.order.create({
                    data: {
                        orderNumber,
                        userId,
                        totalAmount: totalAmountStr,
                        currency: data.currency || currency,
                        status: OrderStatus.PENDING,
                        buyerProtection,
                        buyerProtectionAmount: new Prisma.Decimal(
                            buyerProtectionUsd.toFixed(8)
                        ),
                        subtotalAmount: new Prisma.Decimal(subtotalStr),
                        discountAmount: new Prisma.Decimal(discountStr),
                        couponId: appliedCoupon?.id ?? null,
                        couponCode: appliedCoupon?.code ?? null,
                    },
                });

                if (appliedCoupon) {
                    const couponUpdate = await tx.coupon.updateMany({
                        where: {
                            id: appliedCoupon.id,
                            isActive: true,
                            deletedAt: null,
                            ...(appliedCoupon.maxUses != null
                                ? { usedCount: { lt: appliedCoupon.maxUses } }
                                : {}),
                            OR: [
                                { expiresAt: null },
                                { expiresAt: { gt: new Date() } },
                            ],
                        },
                        data: { usedCount: { increment: 1 } },
                    });
                    if (couponUpdate.count !== 1) {
                        throw new HttpException(
                            'coupon.error.exhausted',
                            HttpStatus.BAD_REQUEST
                        );
                    }
                }

                // Create order items and update stock
                const orderItems = [];
                for (const cartItem of cart.items) {
                    const product = cartItem.product;
                    const basePrice =
                        typeof product.price === 'string'
                            ? product.price
                            : product.price.toString();

                    const priceAtPurchase =
                        cartItem.unitPrice != null
                            ? cartItem.unitPrice.toString()
                            : basePrice;

                    let variantLabel: string | null = null;
                    if (cartItem.variantId) {
                        const v = await tx.productVariant.findUnique({
                            where: { id: cartItem.variantId },
                        });
                        variantLabel = v?.label ?? null;
                    }

                    const orderItem = await tx.orderItem.create({
                        data: {
                            orderId: newOrder.id,
                            productId: cartItem.productId,
                            quantity: cartItem.quantity,
                            priceAtPurchase,
                            variantId: cartItem.variantId,
                            variantLabel,
                        },
                    });

                    if (cartItem.variantId) {
                        await this.stockLineService.allocateForOrderItem(
                            tx,
                            orderItem.id,
                            cartItem.variantId,
                            cartItem.quantity,
                            this.stockLineService.getDefaultReservationDeadline()
                        );
                    } else {
                        await tx.product.update({
                            where: { id: cartItem.productId },
                            data: {
                                stockQuantity: {
                                    decrement: cartItem.quantity,
                                },
                            },
                        });
                    }

                    orderItems.push(orderItem);
                }

                // Cart is intentionally NOT cleared here. It is cleared atomically
                // with payment capture (wallet/crypto/fiat completion), so a failed
                // or abandoned payment leaves the cart intact for retry.
                return { order: newOrder, items: orderItems };
            });

            // Fetch complete order with items and crypto payment
            const completeOrder = await this.fetchCompleteOrder(order.order.id);

            this.logger.info(
                {
                    orderId: order.order.id,
                    orderNumber,
                    userId,
                    totalAmount: totalAmountStr,
                },
                'Order created'
            );

            // Note: Crypto payment creation is handled via separate endpoint
            // POST /v1/crypto-payments/orders/:orderId
            // This allows for better separation of concerns and error handling

            return completeOrder as unknown as OrderResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to create order: ${error.message}`);
            throw new HttpException(
                'order.error.createOrderFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async payOrderWithWallet(
        orderId: string,
        userId: string
    ): Promise<OrderResponseDto> {
        try {
            const order = await this.databaseService.order.findFirst({
                where: {
                    id: orderId,
                    userId,
                    status: OrderStatus.PENDING,
                    deletedAt: null,
                },
            });

            if (!order) {
                throw new HttpException(
                    'order.error.orderNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            const totalAmount =
                typeof order.totalAmount === 'string'
                    ? parseFloat(order.totalAmount)
                    : Number(order.totalAmount);

            try {
                await this.walletService.deductBalance(
                    userId,
                    totalAmount,
                    `Purchase: ${order.orderNumber}`,
                    order.id
                );
            } catch (error) {
                if (
                    error instanceof HttpException &&
                    error.message === 'wallet.error.insufficientBalance'
                ) {
                    throw new HttpException(
                        'order.error.insufficientWalletBalance',
                        HttpStatus.BAD_REQUEST
                    );
                }
                throw error;
            }

            const updatedOrder = await this.databaseService.$transaction(
                async tx => {
                    await this.stockLineService.markSoldForOrder(tx, orderId);
                    // Clear the cart atomically with payment capture.
                    await tx.cartItem.deleteMany({
                        where: { cart: { userId } },
                    });
                    return tx.order.update({
                        where: { id: orderId },
                        data: {
                            status: OrderStatus.COMPLETED,
                            completedAt: new Date(),
                        },
                        include: {
                            items: {
                                include: {
                                    product: {
                                        include: {
                                            category: true,
                                            images: {
                                                where: { deletedAt: null },
                                                orderBy: [
                                                    { isPrimary: 'desc' },
                                                    { sortOrder: 'asc' },
                                                ],
                                            },
                                        },
                                    },
                                },
                            },
                            cryptoPayment: true,
                        },
                    });
                }
            );

            try {
                await this.deliveryService.processInstantDelivery(orderId);
            } catch (deliveryError) {
                this.logger.warn(
                    {
                        orderId,
                        error: deliveryError?.message,
                    },
                    'Failed to process instant delivery after wallet payment'
                );
            }

            await this.enqueueOrderConfirmedEmail(
                orderId,
                'Wallet',
                totalAmount
            );

            return updatedOrder as unknown as OrderResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            this.logger.error(
                { error, orderId, userId },
                'Failed to pay order with wallet'
            );
            throw new HttpException(
                'order.error.walletPaymentFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get order history for user
     */
    async getOrderHistory(
        userId: string,
        options?: {
            page?: number;
            limit?: number;
            status?: OrderStatus;
            sortBy?: 'createdAt' | 'totalAmount';
            sortOrder?: 'asc' | 'desc';
            cryptocurrency?: string;
        }
    ): Promise<ApiPaginatedDataDto<OrderResponseDto>> {
        try {
            const where: any = {
                userId,
                deletedAt: null,
            };

            if (options?.status) {
                where.status = options.status;
            }

            if (options?.cryptocurrency) {
                where.cryptoPayment = {
                    cryptocurrency: options.cryptocurrency,
                };
            }

            const result =
                await this.paginationService.paginate<OrderResponseDto>(
                    this.databaseService.order,
                    {
                        page: options?.page ?? 1,
                        limit: options?.limit ?? 10,
                    },
                    {
                        where,
                        include: {
                            items: {
                                include: {
                                    product: {
                                        include: {
                                            category: true,
                                            images: {
                                                where: { deletedAt: null },
                                                orderBy: [
                                                    { isPrimary: 'desc' },
                                                    { sortOrder: 'asc' },
                                                ],
                                            },
                                        },
                                    },
                                    vouches: {
                                        where: { deletedAt: null },
                                        orderBy: { createdAt: 'desc' },
                                    },
                                },
                            },
                            cryptoPayment: true,
                            review: true,
                        },
                        orderBy: {
                            [options?.sortBy ?? 'createdAt']:
                                options?.sortOrder ?? 'desc',
                        },
                    }
                );

            return result;
        } catch (error) {
            this.logger.error(`Failed to get order history: ${error.message}`);
            throw new HttpException(
                'order.error.getOrderHistoryFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get order detail
     */
    async getOrderDetail(
        orderId: string,
        userId?: string,
        skipOwnershipCheck = false
    ): Promise<OrderDetailResponseDto> {
        try {
            const order = await this.databaseService.order.findFirst({
                where: {
                    id: orderId,
                    deletedAt: null,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            userName: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                    items: {
                        include: {
                            product: {
                                include: {
                                    category: true,
                                    images: {
                                        where: { deletedAt: null },
                                        orderBy: [
                                            { isPrimary: 'desc' },
                                            { sortOrder: 'asc' },
                                        ],
                                    },
                                },
                            },
                            vouches: {
                                where: { deletedAt: null },
                                orderBy: { createdAt: 'desc' },
                            },
                        },
                    },
                    cryptoPayment: true,
                    review: true,
                },
            });

            if (!order) {
                throw new HttpException(
                    'order.error.orderNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            if (!skipOwnershipCheck) {
                if (!userId || order.userId !== userId) {
                    throw new HttpException(
                        'order.error.orderNotFound',
                        HttpStatus.NOT_FOUND
                    );
                }
            }

            return order as unknown as OrderDetailResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to get order detail: ${error.message}`);
            throw new HttpException(
                'order.error.getOrderDetailFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Update order status
     */
    async updateOrderStatus(
        orderId: string,
        data: OrderStatusUpdateDto
    ): Promise<OrderResponseDto> {
        try {
            const order = await this.databaseService.order.findFirst({
                where: {
                    id: orderId,
                    deletedAt: null,
                },
            });

            if (!order) {
                throw new HttpException(
                    'order.error.orderNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            this.activityLogEmitter.captureBefore({
                before: { status: order.status },
            });

            const updateData: any = {
                status: data.status,
            };

            // Set completedAt if status is COMPLETED
            if (data.status === OrderStatus.COMPLETED && !order.completedAt) {
                updateData.completedAt = new Date();
            }

            // Set cancelledAt if status is CANCELLED
            if (data.status === OrderStatus.CANCELLED && !order.cancelledAt) {
                updateData.cancelledAt = new Date();
            }

            let updatedOrder;
            if (data.status === OrderStatus.COMPLETED) {
                updatedOrder = await this.databaseService.$transaction(
                    async tx => {
                        await this.stockLineService.markSoldForOrder(
                            tx,
                            orderId
                        );
                        return tx.order.update({
                            where: { id: orderId },
                            data: updateData,
                            include: {
                                items: {
                                    include: {
                                        product: {
                                            include: {
                                                category: true,
                                                images: {
                                                    where: { deletedAt: null },
                                                    orderBy: [
                                                        { isPrimary: 'desc' },
                                                        { sortOrder: 'asc' },
                                                    ],
                                                },
                                            },
                                        },
                                    },
                                },
                                cryptoPayment: true,
                            },
                        });
                    }
                );
            } else {
                updatedOrder = await this.databaseService.order.update({
                    where: { id: orderId },
                    data: updateData,
                    include: {
                        items: {
                            include: {
                                product: {
                                    include: {
                                        category: true,
                                        images: {
                                            where: { deletedAt: null },
                                            orderBy: [
                                                { isPrimary: 'desc' },
                                                { sortOrder: 'asc' },
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                        cryptoPayment: true,
                    },
                });
            }

            this.logger.info(
                {
                    orderId,
                    oldStatus: order.status,
                    newStatus: data.status,
                },
                'Order status updated'
            );

            this.activityLogEmitter.captureAfter({
                after: { status: updatedOrder.status },
                resourceLabel: `#${updatedOrder.orderNumber}`,
            });

            // Process instant delivery if status changed to COMPLETED
            if (data.status === OrderStatus.COMPLETED) {
                try {
                    await this.deliveryService.processInstantDelivery(orderId);
                } catch (deliveryError) {
                    this.logger.warn(
                        {
                            orderId,
                            error: deliveryError?.message,
                        },
                        'Failed to process instant delivery after status update'
                    );
                }
            }

            return updatedOrder as unknown as OrderResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(
                `Failed to update order status: ${error.message}`
            );
            throw new HttpException(
                'order.error.updateOrderStatusFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Refund order: update status to REFUNDED and refund amount to user wallet
     */
    async refundOrder(orderId: string): Promise<ApiGenericResponseDto> {
        try {
            const order = await this.databaseService.order.findFirst({
                where: { id: orderId, deletedAt: null },
                include: { items: true },
            });

            if (!order) {
                throw new HttpException(
                    'order.error.orderNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            if (
                order.status !== OrderStatus.COMPLETED &&
                order.status !== OrderStatus.CANCELLED
            ) {
                throw new HttpException(
                    'order.error.cannotRefundOrder',
                    HttpStatus.BAD_REQUEST
                );
            }

            if (order.items.length > 0) {
                await this.databaseService.$transaction(async tx => {
                    for (const item of order.items) {
                        await this.stockLineService.retireForOrderItem(
                            tx,
                            item.id
                        );
                    }
                });
            }

            await this.updateOrderStatus(orderId, {
                status: OrderStatus.REFUNDED,
            });

            const totalAmount =
                typeof order.totalAmount === 'string'
                    ? parseFloat(order.totalAmount)
                    : Number(order.totalAmount);

            if (order.userId) {
                await this.walletService.refundBalance(
                    order.userId,
                    totalAmount,
                    `Refund for order ${order.orderNumber}`,
                    order.id
                );
            }

            this.logger.info({ orderId }, 'Order refunded successfully');

            return {
                success: true,
                message: 'order.success.refunded',
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to refund order: ${error.message}`);
            throw new HttpException(
                'order.error.refundFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Issue replacement gift-card content for selected order items.
     *
     * For each chosen order item: retire its currently-SOLD stock lines
     * (StockLineStatus.REFUNDED), allocate fresh AVAILABLE lines for the
     * same variant, mark them SOLD, and refresh the item's deliveredContent.
     * If a ticketId is supplied, post a staff system message describing
     * the replacement and move the ticket to RESOLVED.
     */
    async issueReplacement(
        orderId: string,
        adminUserId: string,
        payload: OrderIssueReplacementDto
    ): Promise<ApiGenericResponseDto> {
        try {
            const order = await this.databaseService.order.findFirst({
                where: { id: orderId, deletedAt: null },
                include: {
                    items: {
                        select: {
                            id: true,
                            variantId: true,
                            quantity: true,
                        },
                    },
                },
            });

            if (!order) {
                throw new HttpException(
                    'order.error.orderNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            if (order.status !== OrderStatus.COMPLETED) {
                throw new HttpException(
                    'order.error.invalidOrderStatusForReplacement',
                    HttpStatus.BAD_REQUEST
                );
            }

            const requested = new Set(payload.orderItemIds);
            const matched = order.items.filter(i => requested.has(i.id));
            if (matched.length !== requested.size) {
                throw new HttpException(
                    'order.error.orderItemNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            for (const item of matched) {
                if (!item.variantId) {
                    throw new HttpException(
                        'order.error.replacementVariantRequired',
                        HttpStatus.BAD_REQUEST
                    );
                }
            }

            const farFuture = new Date(Date.now() + 60 * 60 * 1000);
            const now = new Date();

            try {
                await this.databaseService.$transaction(async tx => {
                    for (const item of matched) {
                        await this.stockLineService.retireForOrderItem(
                            tx,
                            item.id
                        );

                        await this.stockLineService.allocateForOrderItem(
                            tx,
                            item.id,
                            item.variantId!,
                            item.quantity,
                            farFuture
                        );

                        await this.stockLineService.markSold(tx, item.id);

                        const fresh = await tx.productStockLine.findMany({
                            where: {
                                orderItemId: item.id,
                                status: StockLineStatus.SOLD,
                            },
                            orderBy: { soldAt: 'desc' },
                            take: item.quantity,
                            select: { content: true },
                        });

                        if (fresh.length > 0) {
                            await tx.orderItem.update({
                                where: { id: item.id },
                                data: {
                                    deliveredContent: fresh
                                        .map(l => l.content)
                                        .join('\n'),
                                    deliveredAt: now,
                                    firstViewedAt: null,
                                },
                            });
                        }
                    }

                    if (payload.ticketId) {
                        const summary = `Replacement issued for ${matched.length} item(s). Previous codes have been retired.`;
                        const body = payload.note
                            ? `${summary}\n\nNote: ${payload.note}`
                            : summary;
                        await this.ticketMessageService.createSystemMessage(
                            payload.ticketId,
                            adminUserId,
                            body,
                            tx
                        );
                        await this.ticketService.resolveIfActive(
                            payload.ticketId,
                            tx
                        );
                    }
                });
            } catch (error) {
                if (
                    error instanceof HttpException &&
                    error.message === 'order.error.insufficientStock'
                ) {
                    throw new HttpException(
                        'order.error.replacementOutOfStock',
                        HttpStatus.BAD_REQUEST
                    );
                }
                throw error;
            }

            this.logger.info(
                {
                    orderId,
                    adminUserId,
                    orderItemIds: payload.orderItemIds,
                    ticketId: payload.ticketId,
                },
                'Replacement issued'
            );

            return {
                success: true,
                message: 'order.success.replacementIssued',
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to issue replacement: ${error.message}`);
            throw new HttpException(
                'order.error.replacementFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Credit a custom USD amount to the order's customer wallet.
     *
     * Does NOT flip the order to REFUNDED — this is partial goodwill credit.
     * For full-order refund use {@link refundOrder}. If a ticketId is supplied,
     * post a staff system message and move the ticket to RESOLVED.
     */
    async issueCredit(
        orderId: string,
        adminUserId: string,
        payload: OrderIssueCreditDto
    ): Promise<ApiGenericResponseDto> {
        try {
            const order = await this.databaseService.order.findFirst({
                where: { id: orderId, deletedAt: null },
                select: {
                    id: true,
                    userId: true,
                    orderNumber: true,
                    totalAmount: true,
                },
            });

            if (!order) {
                throw new HttpException(
                    'order.error.orderNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            const orderTotal =
                typeof order.totalAmount === 'string'
                    ? parseFloat(order.totalAmount)
                    : Number(order.totalAmount);
            if (
                Number.isFinite(orderTotal) &&
                payload.amount > orderTotal + 1e-6
            ) {
                throw new HttpException(
                    'order.error.creditExceedsOrderTotal',
                    HttpStatus.BAD_REQUEST
                );
            }

            await this.walletService.refundBalance(
                order.userId,
                payload.amount,
                `Store credit for ${order.orderNumber}: ${payload.reason}`,
                order.id
            );

            if (payload.ticketId) {
                const formatted = payload.amount.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                });
                const body = `Issued ${formatted} store credit. Reason: ${payload.reason}`;
                await this.ticketMessageService.createSystemMessage(
                    payload.ticketId,
                    adminUserId,
                    body
                );
                await this.ticketService.resolveIfActive(payload.ticketId);
            }

            this.logger.info(
                {
                    orderId,
                    adminUserId,
                    amount: payload.amount,
                    ticketId: payload.ticketId,
                },
                'Store credit issued'
            );

            return {
                success: true,
                message: 'order.success.creditIssued',
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to issue credit: ${error.message}`);
            throw new HttpException(
                'order.error.creditFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Cancel order
     */
    async cancelOrder(
        orderId: string,
        userId: string
    ): Promise<OrderResponseDto> {
        try {
            const order = await this.databaseService.order.findFirst({
                where: {
                    id: orderId,
                    userId,
                    deletedAt: null,
                },
                include: {
                    items: true,
                    cryptoPayment: true,
                },
            });

            if (!order) {
                throw new HttpException(
                    'order.error.orderNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            // Only allow cancellation if order is PENDING
            if (order.status !== OrderStatus.PENDING) {
                throw new HttpException(
                    'order.error.cannotCancelOrder',
                    HttpStatus.BAD_REQUEST
                );
            }

            // Restore stock and cancel order in transaction
            const cancelledOrder = await this.databaseService.$transaction(
                async tx => {
                    for (const item of order.items) {
                        await this.stockLineService.restoreCancelledOrderItem(
                            tx,
                            {
                                id: item.id,
                                variantId: item.variantId,
                                productId: item.productId,
                                quantity: item.quantity,
                            }
                        );
                    }

                    // Update order status
                    return await tx.order.update({
                        where: { id: orderId },
                        data: {
                            status: OrderStatus.CANCELLED,
                            cancelledAt: new Date(),
                        },
                        include: {
                            items: {
                                include: {
                                    product: {
                                        include: {
                                            category: true,
                                            images: {
                                                where: { deletedAt: null },
                                                orderBy: [
                                                    { isPrimary: 'desc' },
                                                    { sortOrder: 'asc' },
                                                ],
                                            },
                                        },
                                    },
                                },
                            },
                            cryptoPayment: true,
                        },
                    });
                }
            );

            this.logger.info({ orderId, userId }, 'Order cancelled');
            return cancelledOrder as unknown as OrderResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to cancel order: ${error.message}`);
            throw new HttpException(
                'order.error.cancelOrderFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get all orders (admin)
     */
    async getAllOrders(options?: {
        page?: number;
        limit?: number;
        status?: OrderStatus;
        userId?: string;
    }): Promise<ApiPaginatedDataDto<OrderDetailResponseDto>> {
        try {
            const where: any = {
                deletedAt: null,
            };

            if (options?.status) {
                where.status = options.status;
            }

            if (options?.userId) {
                where.userId = options.userId;
            }

            const result =
                await this.paginationService.paginate<OrderDetailResponseDto>(
                    this.databaseService.order,
                    {
                        page: options?.page ?? 1,
                        limit: options?.limit ?? 10,
                    },
                    {
                        where,
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    email: true,
                                    userName: true,
                                    firstName: true,
                                    lastName: true,
                                },
                            },
                            items: {
                                include: {
                                    product: {
                                        include: {
                                            category: true,
                                            images: {
                                                where: { deletedAt: null },
                                                orderBy: [
                                                    { isPrimary: 'desc' },
                                                    { sortOrder: 'asc' },
                                                ],
                                            },
                                        },
                                    },
                                },
                            },
                            cryptoPayment: true,
                        },
                        orderBy: { createdAt: 'desc' },
                    }
                );

            return result;
        } catch (error) {
            this.logger.error(`Failed to get all orders: ${error.message}`);
            throw new HttpException(
                'order.error.getAllOrdersFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    private async enqueueOrderConfirmedEmail(
        orderId: string,
        paymentMethod: string,
        totalAmountUsd: number
    ): Promise<void> {
        try {
            const order = await this.databaseService.order.findUnique({
                where: { id: orderId },
                include: { user: true },
            });
            if (!order || !order.user) return;

            const frontendUrl =
                this.configService.get<string>('app.frontendUrl') ??
                'http://localhost:3000';
            const dashboardLink = `${frontendUrl.replace(/\/$/, '')}/orders/${order.id}`;
            const formatted = `$${totalAmountUsd.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`;
            const completedAt = order.completedAt ?? new Date();

            this.emailQueue.add(EMAIL_TEMPLATES.ORDER_CONFIRMED, {
                data: {
                    order_id: order.orderNumber,
                    payment_method: paymentMethod,
                    amount: formatted,
                    date: completedAt.toISOString().slice(0, 10),
                    dashboard_link: dashboardLink,
                },
                toEmails: [order.user.email],
            } as ISendEmailBasePayload<IOrderConfirmedPayload>);
        } catch (error) {
            this.logger.error(
                { error, orderId },
                'Failed to enqueue order-confirmed email'
            );
        }
    }
}
