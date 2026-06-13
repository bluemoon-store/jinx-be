import { HttpStatus, Injectable, HttpException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from 'src/common/database/services/database.service';
import { calculateLineItemsTotals } from 'src/common/utils/commerce.util';

import { CartAddItemDto } from '../dtos/request/cart.add-item.request';
import { CartSyncDto } from '../dtos/request/cart.sync.request';
import { CartUpdateItemDto } from '../dtos/request/cart.update-item.request';
import { CartResponseDto } from '../dtos/response/cart.response';
import { ICartService } from '../interfaces/cart.service.interface';

@Injectable()
export class CartService implements ICartService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(CartService.name);
    }

    /**
     * Validate product (and optional variant) before adding to cart.
     * Returns unit price snapshot for the line.
     */
    private async validateProductLine(
        productId: string,
        _quantity: number,
        variantId?: string | null
    ): Promise<{ unitPrice: string }> {
        const product = await this.databaseService.product.findFirst({
            where: {
                id: productId,
                deletedAt: null,
            },
        });

        if (!product) {
            throw new HttpException(
                'cart.error.productNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        if (!product.isActive) {
            throw new HttpException(
                'cart.error.productInactive',
                HttpStatus.BAD_REQUEST
            );
        }

        if (variantId) {
            const variant = await this.databaseService.productVariant.findFirst(
                {
                    where: {
                        id: variantId,
                        productId,
                        deletedAt: null,
                        isActive: true,
                    },
                }
            );

            if (!variant) {
                throw new HttpException(
                    'cart.error.variantNotFound',
                    HttpStatus.BAD_REQUEST
                );
            }

            // The cart is an intent list: we do NOT hard-fail on stock here.
            // Stock is enforced atomically at order creation/payment
            // (order.service `validateCartForOrder` + stock-line `allocateForOrderItem`),
            // so a buyer's own pending reservation can't make their cart sync fail.
            return {
                unitPrice:
                    typeof variant.price === 'string'
                        ? variant.price
                        : variant.price.toString(),
            };
        }

        // No variant: same intent-list policy — no stock check at the cart layer.
        return {
            unitPrice:
                typeof product.price === 'string'
                    ? product.price
                    : product.price.toString(),
        };
    }

    /**
     * Get or create cart for user
     */
    async getOrCreateCart(userId: string): Promise<CartResponseDto> {
        try {
            let cart = await this.databaseService.cart.findUnique({
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
                        orderBy: { createdAt: 'desc' },
                    },
                },
            });

            if (!cart) {
                cart = await this.databaseService.cart.create({
                    data: {
                        userId,
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
                            orderBy: { createdAt: 'desc' },
                        },
                    },
                });
            }

            const totals = calculateLineItemsTotals(cart.items);

            return {
                ...cart,
                ...totals,
            } as unknown as CartResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to get or create cart: ${error.message}`);
            throw new HttpException(
                'cart.error.getCartFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get cart for user (creates cart if it doesn't exist)
     */
    async getCart(userId: string): Promise<CartResponseDto> {
        return this.getOrCreateCart(userId);
    }

    /**
     * Add item to cart
     */
    async addItem(
        userId: string,
        data: CartAddItemDto
    ): Promise<CartResponseDto> {
        try {
            const { unitPrice } = await this.validateProductLine(
                data.productId,
                data.quantity,
                data.variantId
            );

            // Get or create cart
            const cart = await this.getOrCreateCart(userId);

            // Check if item already exists in cart
            const existingItem = await this.databaseService.cartItem.findFirst({
                where: {
                    cartId: cart.id,
                    productId: data.productId,
                    variantId: data.variantId ?? null,
                },
                include: {
                    product: true,
                },
            });

            if (existingItem) {
                // Update quantity
                const newQuantity = existingItem.quantity + data.quantity;

                await this.validateProductLine(
                    data.productId,
                    newQuantity,
                    data.variantId
                );

                await this.databaseService.cartItem.update({
                    where: { id: existingItem.id },
                    data: {
                        quantity: newQuantity,
                        unitPrice,
                    },
                });
            } else {
                await this.databaseService.cartItem.create({
                    data: {
                        cartId: cart.id,
                        productId: data.productId,
                        quantity: data.quantity,
                        variantId: data.variantId ?? null,
                        unitPrice,
                    },
                });
            }

            // Return updated cart
            const response = await this.getCart(userId);
            return response;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to add item to cart: ${error.message}`);
            throw new HttpException(
                'cart.error.addItemFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Update item quantity in cart
     */
    async updateItem(
        userId: string,
        itemId: string,
        data: CartUpdateItemDto
    ): Promise<CartResponseDto> {
        try {
            const cart = await this.getOrCreateCart(userId);

            // Find cart item
            const cartItem = await this.databaseService.cartItem.findFirst({
                where: {
                    id: itemId,
                    cartId: cart.id,
                },
                include: {
                    product: true,
                },
            });

            if (!cartItem) {
                throw new HttpException(
                    'cart.error.itemNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            // Validate product and stock
            await this.validateProductLine(
                cartItem.productId,
                data.quantity,
                cartItem.variantId
            );

            // Update quantity
            await this.databaseService.cartItem.update({
                where: { id: itemId },
                data: { quantity: data.quantity },
            });

            // Return updated cart
            return this.getCart(userId);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to update cart item: ${error.message}`);
            throw new HttpException(
                'cart.error.updateItemFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Remove item from cart
     */
    async removeItem(userId: string, itemId: string): Promise<CartResponseDto> {
        try {
            const cart = await this.getOrCreateCart(userId);

            // Find cart item
            const cartItem = await this.databaseService.cartItem.findFirst({
                where: {
                    id: itemId,
                    cartId: cart.id,
                },
            });

            if (!cartItem) {
                throw new HttpException(
                    'cart.error.itemNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            // Delete cart item
            await this.databaseService.cartItem.delete({
                where: { id: itemId },
            });

            // Return updated cart
            return this.getCart(userId);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to remove cart item: ${error.message}`);
            throw new HttpException(
                'cart.error.removeItemFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Clear all items from cart
     */
    async clearCart(userId: string): Promise<CartResponseDto> {
        try {
            const cart = await this.getOrCreateCart(userId);

            // Delete all cart items
            await this.databaseService.cartItem.deleteMany({
                where: { cartId: cart.id },
            });

            // Return empty cart
            return this.getCart(userId);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to clear cart: ${error.message}`);
            throw new HttpException(
                'cart.error.clearCartFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Atomically replace all cart items
     */
    async syncCart(
        userId: string,
        data: CartSyncDto
    ): Promise<CartResponseDto> {
        try {
            const cart = await this.getOrCreateCart(userId);

            const validatedItems = await Promise.all(
                data.items.map(async item => {
                    const { unitPrice } = await this.validateProductLine(
                        item.productId,
                        item.quantity,
                        item.variantId
                    );

                    return {
                        ...item,
                        unitPrice,
                    };
                })
            );

            await this.databaseService.$transaction(async tx => {
                await tx.cartItem.deleteMany({
                    where: { cartId: cart.id },
                });

                if (validatedItems.length > 0) {
                    await tx.cartItem.createMany({
                        data: validatedItems.map(item => ({
                            cartId: cart.id,
                            productId: item.productId,
                            quantity: item.quantity,
                            variantId: item.variantId ?? null,
                            unitPrice: item.unitPrice,
                        })),
                    });
                }
            });

            return this.getCart(userId);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to sync cart: ${error.message}`);
            throw new HttpException(
                'cart.error.syncCartFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}
