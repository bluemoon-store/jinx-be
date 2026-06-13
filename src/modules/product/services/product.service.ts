import {
    ForbiddenException,
    HttpStatus,
    Injectable,
    HttpException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Prisma, ProductType, Role } from '@prisma/client';

import { IAuthUser } from 'src/common/request/interfaces/request.interface';

import { DatabaseService } from 'src/common/database/services/database.service';
import { SupabaseStorageService } from 'src/common/storage/services/supabase.storage.service';
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
    generateUniqueReferenceCode,
    REFERENCE_PREFIX,
} from '../../../common/utils/reference-code.util';
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
    creator: {
        select: {
            id: true,
            firstName: true,
            lastName: true,
            userName: true,
            email: true,
            role: true,
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
        const creator = product.creator;
        const createdByName = creator
            ? [creator.firstName, creator.lastName]
                  .filter(Boolean)
                  .join(' ')
                  .trim() ||
              creator.userName ||
              creator.email
            : null;
        const createdByRole = creator?.role ?? null;
        return {
            ...product,
            variants,
            primaryImageUrl,
            fromPrice,
            tags,
            createdById: product.createdById ?? null,
            createdByName,
            createdByRole,
        } as ProductListResponseDto;
    }

    private mapToDetailDto(
        product: Prisma.ProductGetPayload<{ include: typeof listInclude }>,
        related: ProductListResponseDto[]
    ): ProductDetailResponseDto {
        const list = this.mapToListDto(product);
        return {
            ...list,
            heroImageUrl: list.primaryImageUrl,
            variants: list.variants,
            related,
        };
    }

    private async findRandomRelated(
        productId: string,
        limit = 10
    ): Promise<ProductListResponseDto[]> {
        const rows = await this.databaseService.$queryRaw<
            Array<{ id: string }>
        >(
            Prisma.sql`SELECT id FROM products
                WHERE is_active = true AND deleted_at IS NULL AND id <> ${productId}
                ORDER BY RANDOM() LIMIT ${limit}`
        );
        const ids = rows.map(r => r.id);
        if (ids.length === 0) return [];
        const products = await this.databaseService.product.findMany({
            where: { id: { in: ids } },
            include: listInclude,
        });
        return products.map(p =>
            this.mapToListDto(
                p as Prisma.ProductGetPayload<{ include: typeof listInclude }>
            )
        );
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
            requesterId?: string;
            requesterRole?: Role;
        },
        base: Prisma.ProductWhereInput = { deletedAt: null }
    ): Prisma.ProductWhereInput {
        const where: Prisma.ProductWhereInput = { ...base };

        // Alliance only sees products they created; other roles see everything.
        if (options.requesterRole === Role.ALLIANCE && options.requesterId) {
            where.createdById = options.requesterId;
        }

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
        priorityFlag?: 'isNew' | 'isHot' | 'isRestocked';
    }): Prisma.ProductOrderByWithRelationInput[] {
        const requested = options.sortBy as
            | keyof Prisma.ProductOrderByWithRelationInput
            | undefined;

        const base: Prisma.ProductOrderByWithRelationInput[] =
            requested && this.publicListSortableFields.has(requested)
                ? [
                      {
                          [requested]:
                              options.sortOrder === SortOrder.ASC
                                  ? 'asc'
                                  : 'desc',
                      } as Prisma.ProductOrderByWithRelationInput,
                  ]
                : this.listOrderBy({
                      isHot: options.isHot,
                      isNew: options.isNew,
                      isRestocked: options.isRestocked,
                  });

        // Prioritise flagged products to the top without filtering them out
        // (boolean desc puts `true` first), then fall back to the base order.
        if (options.priorityFlag) {
            return [
                {
                    [options.priorityFlag]: 'desc',
                } as Prisma.ProductOrderByWithRelationInput,
                ...base,
            ];
        }

        return base;
    }

    /**
     * A product counts as in stock when it has product-level stock OR at least
     * one active variant with stock — mirroring the storefront's out-of-stock
     * badge logic.
     */
    private static readonly IN_STOCK_CONDITION: Prisma.ProductWhereInput = {
        OR: [
            { stockQuantity: { gt: 0 } },
            {
                variants: {
                    some: { isActive: true, stockQuantity: { gt: 0 } },
                },
            },
        ],
    };

    /**
     * Paginate products with in-stock items first and out-of-stock items pushed
     * to the end, preserving `orderBy` within each group. The page is sliced
     * across two buckets (A = in stock, B = out of stock) so the ordering is
     * applied at the database level, before LIMIT/OFFSET — necessary because the
     * storefront grid is server-paginated and a client-side sort could only
     * reorder the page already loaded.
     */
    private async paginateInStockFirst(
        where: Prisma.ProductWhereInput,
        orderBy: Prisma.ProductOrderByWithRelationInput[],
        page: number,
        limit: number
    ): Promise<
        ApiPaginatedDataDto<
            Prisma.ProductGetPayload<{ include: typeof listInclude }>
        >
    > {
        const currentPage = Math.max(1, page);
        const itemsPerPage = Math.min(Math.max(1, limit), 100);
        const skip = (currentPage - 1) * itemsPerPage;

        const inStockWhere: Prisma.ProductWhereInput = {
            AND: [where, ProductService.IN_STOCK_CONDITION],
        };
        const outOfStockWhere: Prisma.ProductWhereInput = {
            AND: [where, { NOT: ProductService.IN_STOCK_CONDITION }],
        };

        // Run sequentially to avoid opening multiple pooled DB connections per
        // request (same rationale as HelperPaginationService).
        const countIn = await this.databaseService.product.count({
            where: inStockWhere,
        });
        const countOut = await this.databaseService.product.count({
            where: outOfStockWhere,
        });
        const totalItems = countIn + countOut;

        // Slice the window [skip, skip + itemsPerPage) across the concatenation
        // [ in-stock (0..countIn) , out-of-stock (countIn..) ].
        const aTake = Math.max(
            0,
            Math.min(skip + itemsPerPage, countIn) - skip
        );
        const bSkip = Math.max(0, skip - countIn);
        const bTake = itemsPerPage - aTake;

        const itemsA =
            aTake > 0
                ? await this.databaseService.product.findMany({
                      where: inStockWhere,
                      include: listInclude,
                      orderBy,
                      skip: Math.min(skip, countIn),
                      take: aTake,
                  })
                : [];
        const itemsB =
            bTake > 0
                ? await this.databaseService.product.findMany({
                      where: outOfStockWhere,
                      include: listInclude,
                      orderBy,
                      skip: bSkip,
                      take: bTake,
                  })
                : [];

        return {
            metadata: {
                totalItems,
                itemsPerPage,
                totalPages: Math.ceil(totalItems / itemsPerPage),
                currentPage,
            },
            items: [...itemsA, ...itemsB],
        };
    }

    async create(
        data: ProductCreateDto,
        createdById?: string
    ): Promise<ProductResponseDto> {
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

            const referenceCode = await generateUniqueReferenceCode(
                REFERENCE_PREFIX.PRODUCT,
                async code =>
                    !!(await this.databaseService.product.findUnique({
                        where: { referenceCode: code },
                    }))
            );

            const product = await this.databaseService.product.create({
                data: {
                    name: data.name,
                    slug,
                    referenceCode,
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
                    createdById: createdById ?? null,
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
        priorityFlag?: 'isNew' | 'isHot' | 'isRestocked';
        requesterId?: string;
        requesterRole?: Role;
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
                requesterId: options?.requesterId,
                requesterRole: options?.requesterRole,
            });

            const orderBy = this.resolveListOrderBy({
                isHot: options?.isHot,
                isNew: options?.isNew,
                isRestocked: options?.isRestocked,
                sortBy: options?.sortBy,
                sortOrder: options?.sortOrder,
                priorityFlag: options?.priorityFlag,
            });

            const result = await this.paginateInStockFirst(
                where,
                orderBy,
                options?.page ?? 1,
                options?.limit ?? 10
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
        query: ProductSearchDto,
        requester?: { requesterId?: string; requesterRole?: Role }
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
                requesterId: requester?.requesterId,
                requesterRole: requester?.requesterRole,
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

            const result = await this.paginateInStockFirst(
                where,
                orderBy,
                query.page ?? 1,
                query.limit ?? 10
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

    async findOne(
        id: string,
        requester?: { requesterId?: string; requesterRole?: Role }
    ): Promise<ProductResponseDto> {
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

            // Alliance may only view products they created; hide others as 404.
            if (
                requester?.requesterRole === Role.ALLIANCE &&
                product.createdById !== requester.requesterId
            ) {
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

    /**
     * Ensures the actor may mutate this product. Alliance can only mutate
     * products they created; other roles are unrestricted. Throws 404 if the
     * product is missing and 403 if an Alliance user targets someone else's product.
     */
    async assertCanMutate(productId: string, user: IAuthUser): Promise<void> {
        if (user.role !== Role.ALLIANCE) {
            return;
        }
        const product = await this.databaseService.product.findFirst({
            where: { id: productId, deletedAt: null },
            select: { createdById: true },
        });
        if (!product) {
            throw new HttpException(
                'product.error.productNotFound',
                HttpStatus.NOT_FOUND
            );
        }
        if (product.createdById !== user.userId) {
            throw new ForbiddenException('product.error.notOwner');
        }
    }

    async findBySlug(slug: string): Promise<ProductDetailResponseDto> {
        try {
            const product = await this.databaseService.product.findFirst({
                where: {
                    slug,
                    deletedAt: null,
                },
                include: listInclude,
            });

            if (!product) {
                throw new HttpException(
                    'product.error.productNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            const related = await this.findRandomRelated(product.id, 10);
            return this.mapToDetailDto(product, related);
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

            const { variants, ...rest } = data as ProductUpdateDto &
                Record<string, unknown>;

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
}
