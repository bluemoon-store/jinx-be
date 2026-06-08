import { HttpStatus, Injectable, HttpException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Prisma, ProductType } from '@prisma/client';

import { DatabaseService } from 'src/common/database/services/database.service';
import { SupabaseStorageService } from 'src/common/storage/services/supabase.storage.service';
import { HelperPaginationService } from 'src/common/helper/services/helper.pagination.service';
import { OrderByInput } from 'src/common/helper/interfaces/pagination.interface';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';

import { SortOrder } from 'src/common/helper/dtos/query.dto';

import { ProductCreateDto } from '../dtos/request/product.create.request';
import { ProductUpdateDto } from '../dtos/request/product.update.request';
import { ProductSearchDto } from '../dtos/request/product.search.request';
import {
    ProductResponseDto,
    ProductListResponseDto,
    ProductDetailResponseDto,
} from '../dtos/response/product.response';
import { IProductService } from '../interfaces/product.service.interface';
import {
    buildProductTags,
    computeFromPrice,
    computePrimaryImageUrl,
    generateSlug,
} from '../utils/product.util';
import {
    AdminProductVariantCreateDto,
    AdminProductVariantUpdateDto,
} from '../dtos/request/product.admin.subresource.request';
import { ActivityLogEmitterService } from 'src/modules/activity-log/services/activity-log.emitter.service';

const productImageOrderBy = [
    { isPrimary: 'desc' as const },
    { sortOrder: 'asc' as const },
];

const listInclude = {
    category: true,
    images: {
        where: { deletedAt: null },
        orderBy: productImageOrderBy,
    },
    variants: {
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' as const },
        include: {
            _count: {
                select: { orderItems: true },
            },
        },
    },
} satisfies Prisma.ProductInclude;

const detailInclude = {
    ...listInclude,
    relatedFrom: {
        include: {
            relatedProduct: {
                include: listInclude,
            },
        },
    },
} satisfies Prisma.ProductInclude;

const adminInclude = {
    category: true,
    images: {
        where: { deletedAt: null },
        orderBy: productImageOrderBy,
    },
    variants: {
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' as const },
        include: {
            _count: {
                select: { orderItems: true },
            },
        },
    },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductService implements IProductService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly paginationService: HelperPaginationService,
        private readonly activityLogEmitter: ActivityLogEmitterService,
        private readonly storageService: SupabaseStorageService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(ProductService.name);
    }

    private mapToListDto(
        product: Prisma.ProductGetPayload<{ include: typeof listInclude }>
    ): ProductListResponseDto {
        const primaryImageUrl = computePrimaryImageUrl(product.images);
        const fromPrice = computeFromPrice(product.price, product.variants);
        const tags = buildProductTags(product);
        const variants = product.variants
            .filter(v => v.isActive && v.deletedAt === null)
            .map(v => {
                const { _count, ...variantRest } = v;
                return {
                    ...variantRest,
                    soldCount: _count?.orderItems ?? 0,
                };
            });
        return {
            ...product,
            variants,
            primaryImageUrl,
            fromPrice,
            tags,
        } as ProductListResponseDto;
    }

    private mapToDetailDto(
        product: Prisma.ProductGetPayload<{ include: typeof detailInclude }>
    ): ProductDetailResponseDto {
        const list = this.mapToListDto(product);
        const related = product.relatedFrom
            .filter(
                row =>
                    row.relatedProduct &&
                    row.relatedProduct.deletedAt === null &&
                    row.relatedProduct.isActive
            )
            .map(row =>
                this.mapToListDto(
                    row.relatedProduct as Prisma.ProductGetPayload<{
                        include: typeof listInclude;
                    }>
                )
            )
            .slice(0, 20);
        return {
            ...list,
            heroImageUrl: list.primaryImageUrl,
            variants: list.variants,
            related,
        };
    }

    private mapToAdminDto(
        product: Prisma.ProductGetPayload<{ include: typeof adminInclude }>
    ): ProductResponseDto {
        const { variants, ...rest } = product;
        return {
            ...rest,
            variants: variants?.map(v => {
                const { _count, ...variantRest } = v;
                return {
                    ...variantRest,
                    soldCount: _count?.orderItems ?? 0,
                };
            }),
        } as ProductResponseDto;
    }

    private async ensureUniqueSlug(
        baseSlug: string,
        excludeId?: string
    ): Promise<string> {
        let slug = baseSlug;
        let counter = 1;

        while (true) {
            const existing = await this.databaseService.product.findFirst({
                where: {
                    slug,
                    ...(excludeId && { id: { not: excludeId } }),
                    deletedAt: null,
                },
            });

            if (!existing) {
                return slug;
            }

            slug = `${baseSlug}-${counter}`;
            counter++;
        }
    }

    private buildListWhere(
        options: {
            categoryId?: string;
            categorySlug?: string;
            isActive?: boolean;
            isHot?: boolean;
            isNew?: boolean;
            isRestocked?: boolean;
            type?: ProductType;
        },
        base: Prisma.ProductWhereInput = { deletedAt: null }
    ): Prisma.ProductWhereInput {
        const where: Prisma.ProductWhereInput = { ...base };

        if (options.categoryId) {
            where.categoryId = options.categoryId;
        }

        if (options.type) {
            where.type = options.type;
        }

        if (options.categorySlug) {
            where.category = { slug: options.categorySlug };
        }

        if (options.isActive !== undefined) {
            where.isActive = options.isActive;
        }

        if (options.isHot !== undefined) {
            where.isHot = options.isHot;
        }

        if (options.isNew !== undefined) {
            where.isNew = options.isNew;
        }

        if (options.isRestocked !== undefined) {
            where.isRestocked = options.isRestocked;
        }

        return where;
    }

    private listOrderBy(options: {
        isHot?: boolean;
        isNew?: boolean;
        isRestocked?: boolean;
    }): Prisma.ProductOrderByWithRelationInput[] {
        if (options.isRestocked) {
            return [{ restockedAt: 'desc' }, { sortOrder: 'asc' }];
        }
        if (options.isNew) {
            return [{ launchedAt: 'desc' }, { sortOrder: 'asc' }];
        }
        if (options.isHot) {
            return [{ sortOrder: 'asc' }, { createdAt: 'desc' }];
        }
        return [{ sortOrder: 'asc' }, { createdAt: 'desc' }];
    }

    /**
     * Whitelist of fields the public list endpoint allows clients to sort by.
     * Anything outside this list is silently ignored so a bad query string
     * cannot crash the endpoint with a Prisma error.
     */
    private readonly publicListSortableFields = new Set<
        keyof Prisma.ProductOrderByWithRelationInput
    >([
        'updatedAt',
        'createdAt',
        'name',
        'sortOrder',
        'launchedAt',
        'restockedAt',
        'price',
    ]);

    private resolveListOrderBy(options: {
        isHot?: boolean;
        isNew?: boolean;
        isRestocked?: boolean;
        sortBy?: string;
        sortOrder?: SortOrder;
    }): Prisma.ProductOrderByWithRelationInput[] {
        const requested = options.sortBy as
            | keyof Prisma.ProductOrderByWithRelationInput
            | undefined;

        if (requested && this.publicListSortableFields.has(requested)) {
            const direction: 'asc' | 'desc' =
                options.sortOrder === SortOrder.ASC ? 'asc' : 'desc';
            return [
                {
                    [requested]: direction,
                } as Prisma.ProductOrderByWithRelationInput,
            ];
        }

        return this.listOrderBy({
            isHot: options.isHot,
            isNew: options.isNew,
            isRestocked: options.isRestocked,
        });
    }

    async create(data: ProductCreateDto): Promise<ProductResponseDto> {
        try {
            const category =
                await this.databaseService.productCategory.findFirst({
                    where: {
                        id: data.categoryId,
                        deletedAt: null,
                    },
                });

            if (!category) {
                throw new HttpException(
                    'product.error.categoryNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            const slug = data.slug
                ? await this.ensureUniqueSlug(generateSlug(data.slug))
                : await this.ensureUniqueSlug(generateSlug(data.name));

            const product = await this.databaseService.product.create({
                data: {
                    name: data.name,
                    slug,
                    description: data.description,
                    price: data.price,
                    type: data.type ?? 'STANDARD',
                    stockQuantity: data.stockQuantity ?? 0,
                    isActive: data.isActive ?? true,
                    sortOrder: data.sortOrder ?? 0,
                    categoryId: data.categoryId,
                    deliveryType: data.deliveryType ?? 'INSTANT',
                    deliveryContent: data.deliveryContent,
                    shortNotice: data.shortNotice,
                    flair: data.flair ?? null,
                    iconUrl: data.iconUrl ?? null,
                    isHot: data.isHot ?? false,
                    isNew: data.isNew ?? false,
                    isNFA: data.isNFA ?? false,
                    isRestocked: data.isRestocked ?? false,
                    launchedAt: data.launchedAt,
                    restockedAt: data.restockedAt,
                    countryOfOrigin: data.countryOfOrigin,
                    redeemProcess: data.redeemProcess,
                    warrantyText: data.warrantyText,
                    warrantyMinutes: data.warrantyMinutes ?? 15,
                    variants: data.variants?.length
                        ? {
                              create: data.variants.map((v, i) => ({
                                  label: v.label,
                                  price: v.price,
                                  stockQuantity: v.stockQuantity ?? 0,
                                  isActive: v.isActive ?? true,
                                  sortOrder: v.sortOrder ?? i,
                              })),
                          }
                        : undefined,
                },
                include: adminInclude,
            });

            if (data.images && data.images.length > 0) {
                const imageData = data.images.map((img, index) => ({
                    productId: product.id,
                    key: img.key,
                    url: this.storageService.getPublicUrl(
                        img.key,
                        'publicAssets'
                    ),
                    isPrimary: img.isPrimary ?? index === 0,
                    sortOrder: img.sortOrder ?? index,
                }));

                if (imageData.some(img => img.isPrimary)) {
                    await this.databaseService.productImage.createMany({
                        data: imageData,
                    });
                } else {
                    imageData[0].isPrimary = true;
                    await this.databaseService.productImage.createMany({
                        data: imageData,
                    });
                }
            }

            const full = await this.databaseService.product.findUnique({
                where: { id: product.id },
                include: adminInclude,
            });

            this.logger.info({ productId: product.id }, 'Product created');
            return this.mapToAdminDto(full!);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to create product: ${error.message}`);
            throw new HttpException(
                'product.error.createProductFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async findAll(options?: {
        page?: number;
        limit?: number;
        categoryId?: string;
        categorySlug?: string;
        isActive?: boolean;
        isHot?: boolean;
        isNew?: boolean;
        isRestocked?: boolean;
        type?: ProductType;
        sortBy?: string;
        sortOrder?: SortOrder;
    }): Promise<ApiPaginatedDataDto<ProductListResponseDto>> {
        try {
            const where = this.buildListWhere({
                categoryId: options?.categoryId,
                categorySlug: options?.categorySlug,
                isActive: options?.isActive,
                isHot: options?.isHot,
                isNew: options?.isNew,
                isRestocked: options?.isRestocked,
                type: options?.type,
            });

            const orderBy = this.resolveListOrderBy({
                isHot: options?.isHot,
                isNew: options?.isNew,
                isRestocked: options?.isRestocked,
                sortBy: options?.sortBy,
                sortOrder: options?.sortOrder,
            });

            type ListPayload = Prisma.ProductGetPayload<{
                include: typeof listInclude;
            }>;

            const result = await this.paginationService.paginate<ListPayload>(
                this.databaseService.product,
                {
                    page: options?.page ?? 1,
                    limit: options?.limit ?? 10,
                },
                {
                    where,
                    include: listInclude,
                    orderBy: orderBy as OrderByInput[],
                }
            );

            return {
                ...result,
                items: result.items.map(p => this.mapToListDto(p)),
            };
        } catch (error) {
            this.logger.error(`Failed to list products: ${error.message}`);
            throw new HttpException(
                'product.error.listProductsFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async search(
        query: ProductSearchDto
    ): Promise<ApiPaginatedDataDto<ProductListResponseDto>> {
        try {
            const where = this.buildListWhere({
                categoryId: query.categoryId,
                categorySlug: query.categorySlug,
                isActive: query.isActive,
                isHot: query.isHot,
                isNew: query.isNew,
                isRestocked: query.isRestocked,
                type: query.type,
            });

            if (query.minPrice !== undefined || query.maxPrice !== undefined) {
                where.price = {};
                if (query.minPrice !== undefined) {
                    where.price.gte = query.minPrice.toString();
                }
                if (query.maxPrice !== undefined) {
                    where.price.lte = query.maxPrice.toString();
                }
            }

            if (query.searchQuery) {
                where.OR = [
                    {
                        name: {
                            contains: query.searchQuery,
                            mode: 'insensitive',
                        },
                    },
                    {
                        description: {
                            contains: query.searchQuery,
                            mode: 'insensitive',
                        },
                    },
                    {
                        slug: {
                            contains: query.searchQuery,
                            mode: 'insensitive',
                        },
                    },
                ];
            }

            let orderBy: Prisma.ProductOrderByWithRelationInput[] = [];
            if (query.sortBy) {
                const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';
                orderBy.push({
                    [query.sortBy]: sortOrder,
                } as Prisma.ProductOrderByWithRelationInput);
            } else {
                orderBy = this.listOrderBy({
                    isHot: query.isHot,
                    isNew: query.isNew,
                    isRestocked: query.isRestocked,
                });
            }

            type ListPayload = Prisma.ProductGetPayload<{
                include: typeof listInclude;
            }>;

            const result = await this.paginationService.paginate<ListPayload>(
                this.databaseService.product,
                {
                    page: query.page ?? 1,
                    limit: query.limit ?? 10,
                },
                {
                    where,
                    include: listInclude,
                    orderBy: orderBy as OrderByInput[],
                }
            );

            return {
                ...result,
                items: result.items.map(p => this.mapToListDto(p)),
            };
        } catch (error) {
            this.logger.error(`Failed to search products: ${error.message}`);
            throw new HttpException(
                'product.error.searchProductsFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async findOne(id: string): Promise<ProductResponseDto> {
        try {
            const product = await this.databaseService.product.findFirst({
                where: {
                    id,
                    deletedAt: null,
                },
                include: adminInclude,
            });

            if (!product) {
                throw new HttpException(
                    'product.error.productNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            return this.mapToAdminDto(product);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to find product: ${error.message}`);
            throw new HttpException(
                'product.error.findProductFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async findBySlug(slug: string): Promise<ProductDetailResponseDto> {
        try {
            const product = await this.databaseService.product.findFirst({
                where: {
                    slug,
                    deletedAt: null,
                },
                include: detailInclude,
            });

            if (!product) {
                throw new HttpException(
                    'product.error.productNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            return this.mapToDetailDto(product);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(
                `Failed to find product by slug: ${error.message}`
            );
            throw new HttpException(
                'product.error.findProductFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    private async syncVariants(
        productId: string,
        variants: ProductUpdateDto['variants']
    ): Promise<void> {
        if (!variants) {
            return;
        }

        const existing = await this.databaseService.productVariant.findMany({
            where: { productId, deletedAt: null },
        });

        const incomingWithId = new Set(
            variants.filter(v => v.id).map(v => v.id as string)
        );

        for (const row of existing) {
            if (!incomingWithId.has(row.id)) {
                await this.databaseService.productVariant.update({
                    where: { id: row.id },
                    data: { deletedAt: new Date() },
                });
            }
        }

        for (const v of variants) {
            if (v.id) {
                const updated =
                    await this.databaseService.productVariant.updateMany({
                        where: { id: v.id, productId },
                        data: {
                            label: v.label,
                            price: v.price,
                            stockQuantity: v.stockQuantity ?? 0,
                            isActive: v.isActive ?? true,
                            sortOrder: v.sortOrder ?? 0,
                        },
                    });
                if (updated.count === 0) {
                    throw new HttpException(
                        'product.error.variantNotFound',
                        HttpStatus.NOT_FOUND
                    );
                }
            } else {
                await this.databaseService.productVariant.create({
                    data: {
                        productId,
                        label: v.label,
                        price: v.price,
                        stockQuantity: v.stockQuantity ?? 0,
                        isActive: v.isActive ?? true,
                        sortOrder: v.sortOrder ?? 0,
                    },
                });
            }
        }
    }

    private async syncRelated(
        productId: string,
        relatedProductIds: string[] | undefined
    ): Promise<void> {
        if (relatedProductIds === undefined) {
            return;
        }

        const unique = [
            ...new Set(relatedProductIds.filter(id => id && id !== productId)),
        ];

        await this.databaseService.productRelated.deleteMany({
            where: { productId },
        });

        if (unique.length === 0) {
            return;
        }

        const existing = await this.databaseService.product.findMany({
            where: { id: { in: unique }, deletedAt: null },
            select: { id: true },
        });
        const allowed = new Set(existing.map(p => p.id));

        await this.databaseService.productRelated.createMany({
            data: unique
                .filter(id => allowed.has(id))
                .map(relatedProductId => ({
                    productId,
                    relatedProductId,
                })),
        });
    }

    async update(
        id: string,
        data: ProductUpdateDto
    ): Promise<ProductResponseDto> {
        try {
            await this.findOne(id);

            if (data.categoryId) {
                const category =
                    await this.databaseService.productCategory.findFirst({
                        where: {
                            id: data.categoryId,
                            deletedAt: null,
                        },
                    });

                if (!category) {
                    throw new HttpException(
                        'product.error.categoryNotFound',
                        HttpStatus.NOT_FOUND
                    );
                }
            }

            let slug = data.slug;
            if (data.name && !data.slug) {
                slug = await this.ensureUniqueSlug(generateSlug(data.name), id);
            } else if (data.slug) {
                slug = await this.ensureUniqueSlug(generateSlug(data.slug), id);
            }

            const { variants, relatedProductIds, ...rest } =
                data as ProductUpdateDto & Record<string, unknown>;

            const updateData: Prisma.ProductUpdateInput = {};

            const assignScalar = <K extends keyof Prisma.ProductUpdateInput>(
                key: K,
                value: Prisma.ProductUpdateInput[K]
            ) => {
                if (value !== undefined) {
                    updateData[key] = value;
                }
            };

            assignScalar('name', rest.name);
            assignScalar('description', rest.description);
            assignScalar('price', rest.price);
            assignScalar('type', rest.type);
            assignScalar('stockQuantity', rest.stockQuantity);
            assignScalar('isActive', rest.isActive);
            assignScalar('sortOrder', rest.sortOrder);
            assignScalar('deliveryType', rest.deliveryType);
            assignScalar('deliveryContent', rest.deliveryContent);
            assignScalar('shortNotice', rest.shortNotice);
            assignScalar('flair', rest.flair);
            assignScalar('iconUrl', rest.iconUrl);
            assignScalar('isHot', rest.isHot);
            assignScalar('isNew', rest.isNew);
            assignScalar('isNFA', rest.isNFA);
            assignScalar('isRestocked', rest.isRestocked);
            assignScalar('launchedAt', rest.launchedAt);
            assignScalar('restockedAt', rest.restockedAt);
            assignScalar('countryOfOrigin', rest.countryOfOrigin);
            assignScalar('redeemProcess', rest.redeemProcess);
            assignScalar('warrantyText', rest.warrantyText);
            assignScalar('warrantyMinutes', rest.warrantyMinutes);

            if (slug) {
                updateData.slug = slug;
            }

            if (rest.categoryId !== undefined) {
                updateData.category = {
                    connect: { id: rest.categoryId },
                };
            }

            await this.databaseService.$transaction([
                this.databaseService.product.update({
                    where: { id },
                    data: updateData,
                }),
            ]);

            await this.syncVariants(id, variants);
            await this.syncRelated(id, relatedProductIds);

            const product = await this.databaseService.product.findUnique({
                where: { id },
                include: adminInclude,
            });

            this.logger.info({ productId: id }, 'Product updated');
            return this.mapToAdminDto(product!);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to update product: ${error.message}`);
            throw new HttpException(
                'product.error.updateProductFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async delete(id: string): Promise<ApiGenericResponseDto> {
        try {
            await this.findOne(id);

            const orderItemCount = await this.databaseService.orderItem.count({
                where: {
                    productId: id,
                },
            });

            if (orderItemCount > 0) {
                throw new HttpException(
                    'product.error.productHasOrders',
                    HttpStatus.BAD_REQUEST
                );
            }

            await this.databaseService.$transaction([
                this.databaseService.product.update({
                    where: { id },
                    data: { deletedAt: new Date() },
                }),
                this.databaseService.productImage.updateMany({
                    where: { productId: id },
                    data: { deletedAt: new Date() },
                }),
            ]);

            this.logger.info({ productId: id }, 'Product deleted');
            return {
                success: true,
                message: 'product.success.productDeleted',
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to delete product: ${error.message}`);
            throw new HttpException(
                'product.error.deleteProductFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async updateStock(
        id: string,
        stockQuantity: number
    ): Promise<ProductResponseDto> {
        try {
            if (stockQuantity < 0) {
                throw new HttpException(
                    'product.error.invalidStockQuantity',
                    HttpStatus.BAD_REQUEST
                );
            }

            const existing = await this.databaseService.product.findFirst({
                where: { id, deletedAt: null },
            });
            if (!existing) {
                throw new HttpException(
                    'product.error.productNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            this.activityLogEmitter.captureBefore({
                before: { stockQuantity: existing.stockQuantity },
            });

            const product = await this.databaseService.product.update({
                where: { id },
                data: { stockQuantity },
                include: adminInclude,
            });

            this.logger.info(
                { productId: id, stockQuantity },
                'Product stock updated'
            );

            this.activityLogEmitter.captureAfter({
                after: { stockQuantity: product.stockQuantity },
                resourceLabel: existing.name,
            });

            return this.mapToAdminDto(product);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to update stock: ${error.message}`);
            throw new HttpException(
                'product.error.updateStockFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async toggleActive(id: string): Promise<ProductResponseDto> {
        try {
            const product = await this.findOne(id);

            this.activityLogEmitter.captureBefore({
                before: { isActive: product.isActive },
            });

            const updated = await this.databaseService.product.update({
                where: { id },
                data: {
                    isActive: !product.isActive,
                },
                include: adminInclude,
            });

            this.logger.info(
                { productId: id, isActive: updated.isActive },
                'Product active status toggled'
            );

            this.activityLogEmitter.captureAfter({
                after: { isActive: updated.isActive },
                resourceLabel: product.name,
            });

            return this.mapToAdminDto(updated);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(
                `Failed to toggle product active status: ${error.message}`
            );
            throw new HttpException(
                'product.error.toggleProductActiveFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async addImage(
        productId: string,
        imageKey?: string,
        isPrimary: boolean = false,
        externalUrl?: string
    ): Promise<ProductResponseDto> {
        try {
            await this.findOne(productId);

            if (isPrimary) {
                await this.databaseService.productImage.updateMany({
                    where: {
                        productId,
                        isPrimary: true,
                        deletedAt: null,
                    },
                    data: { isPrimary: false },
                });
            }

            const maxSortOrder =
                await this.databaseService.productImage.findFirst({
                    where: {
                        productId,
                        deletedAt: null,
                    },
                    orderBy: { sortOrder: 'desc' },
                    select: { sortOrder: true },
                });

            const sortOrder = maxSortOrder ? maxSortOrder.sortOrder + 1 : 0;

            // External link: store the URL as-is. Storage key: derive a public
            // URL from the key. `key` is non-nullable, so for external links we
            // store the URL in both columns (removeImage is a soft-delete and
            // never touches storage by key, so this is safe).
            const resolvedKey = imageKey ?? externalUrl;
            const resolvedUrl = externalUrl
                ? externalUrl
                : this.storageService.getPublicUrl(imageKey, 'publicAssets');

            await this.databaseService.productImage.create({
                data: {
                    productId,
                    key: resolvedKey,
                    url: resolvedUrl,
                    isPrimary,
                    sortOrder,
                },
            });

            return this.findOne(productId);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to add image: ${error.message}`);
            throw new HttpException(
                'product.error.addImageFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async removeImage(
        productId: string,
        imageId: string
    ): Promise<ProductResponseDto> {
        try {
            await this.findOne(productId);

            const image = await this.databaseService.productImage.findFirst({
                where: {
                    id: imageId,
                    productId,
                    deletedAt: null,
                },
            });

            if (!image) {
                throw new HttpException(
                    'product.error.imageNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            await this.databaseService.productImage.update({
                where: { id: imageId },
                data: { deletedAt: new Date() },
            });

            if (image.isPrimary) {
                const nextImage =
                    await this.databaseService.productImage.findFirst({
                        where: {
                            productId,
                            deletedAt: null,
                        },
                        orderBy: { sortOrder: 'asc' },
                    });

                if (nextImage) {
                    await this.databaseService.productImage.update({
                        where: { id: nextImage.id },
                        data: { isPrimary: true },
                    });
                }
            }

            return this.findOne(productId);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to remove image: ${error.message}`);
            throw new HttpException(
                'product.error.removeImageFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async setPrimaryImage(
        productId: string,
        imageId: string
    ): Promise<ProductResponseDto> {
        try {
            await this.findOne(productId);

            const image = await this.databaseService.productImage.findFirst({
                where: {
                    id: imageId,
                    productId,
                    deletedAt: null,
                },
            });

            if (!image) {
                throw new HttpException(
                    'product.error.imageNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            await this.databaseService.productImage.updateMany({
                where: {
                    productId,
                    isPrimary: true,
                    deletedAt: null,
                },
                data: { isPrimary: false },
            });

            await this.databaseService.productImage.update({
                where: { id: imageId },
                data: { isPrimary: true },
            });

            return this.findOne(productId);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to set primary image: ${error.message}`);
            throw new HttpException(
                'product.error.setPrimaryImageFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async addVariant(
        productId: string,
        dto: AdminProductVariantCreateDto
    ): Promise<ProductResponseDto> {
        await this.findOne(productId);
        await this.databaseService.productVariant.create({
            data: {
                productId,
                label: dto.label,
                price: dto.price,
                stockQuantity: dto.stockQuantity ?? 0,
                isActive: dto.isActive ?? true,
                sortOrder: dto.sortOrder ?? 0,
            },
        });
        return this.findOne(productId);
    }

    async updateVariant(
        productId: string,
        variantId: string,
        dto: AdminProductVariantUpdateDto
    ): Promise<ProductResponseDto> {
        await this.findOne(productId);
        const v = await this.databaseService.productVariant.findFirst({
            where: { id: variantId, productId, deletedAt: null },
        });
        if (!v) {
            throw new HttpException(
                'product.error.variantNotFound',
                HttpStatus.NOT_FOUND
            );
        }
        await this.databaseService.productVariant.update({
            where: { id: variantId },
            data: {
                ...(dto.label !== undefined && { label: dto.label }),
                ...(dto.price !== undefined && { price: dto.price }),
                ...(dto.stockQuantity !== undefined && {
                    stockQuantity: dto.stockQuantity,
                }),
                ...(dto.isActive !== undefined && { isActive: dto.isActive }),
                ...(dto.sortOrder !== undefined && {
                    sortOrder: dto.sortOrder,
                }),
            },
        });
        return this.findOne(productId);
    }

    async deleteVariant(
        productId: string,
        variantId: string
    ): Promise<ProductResponseDto> {
        await this.findOne(productId);
        const v = await this.databaseService.productVariant.findFirst({
            where: { id: variantId, productId, deletedAt: null },
        });
        if (!v) {
            throw new HttpException(
                'product.error.variantNotFound',
                HttpStatus.NOT_FOUND
            );
        }
        await this.databaseService.productVariant.update({
            where: { id: variantId },
            data: { deletedAt: new Date() },
        });
        return this.findOne(productId);
    }

    async setRelatedProducts(
        productId: string,
        relatedProductIds: string[]
    ): Promise<ProductResponseDto> {
        await this.syncRelated(productId, relatedProductIds);
        return this.findOne(productId);
    }
}
