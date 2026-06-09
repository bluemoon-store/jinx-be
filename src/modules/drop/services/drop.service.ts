import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, StockLineStatus } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { DatabaseService } from 'src/common/database/services/database.service';
import { HelperPaginationService } from 'src/common/helper/services/helper.pagination.service';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';
import { StockLineService } from 'src/modules/stock-line/services/stock-line.service';

import { DropCreateDto } from '../dtos/request/drop.create.request';
import {
    DropListQueryDto,
    DropListTab,
} from '../dtos/request/drop.list.request';
import { DropUpdateDto } from '../dtos/request/drop.update.request';
import {
    DropClaimResponseDto,
    MyDropClaimResponseDto,
} from '../dtos/response/drop.claim.response';
import { DropPublicResponseDto } from '../dtos/response/drop.public.response';
import { DropResponseDto } from '../dtos/response/drop.response';
import {
    daysRemaining,
    deriveDropStatus,
    isUserAllowed,
} from '../utils/drop.util';
import {
    generateUniqueReferenceCode,
    REFERENCE_PREFIX,
} from '../../../common/utils/reference-code.util';

@Injectable()
export class DropService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly paginationService: HelperPaginationService,
        private readonly stockLineService: StockLineService
    ) {}

    private static readonly DROP_INCLUDE = {
        product: {
            select: {
                id: true,
                name: true,
                slug: true,
                iconUrl: true,
                images: {
                    where: { deletedAt: null },
                    select: { url: true, isPrimary: true, sortOrder: true },
                    orderBy: [
                        { isPrimary: 'desc' as const },
                        { sortOrder: 'asc' as const },
                    ],
                    take: 1,
                },
            },
        },
        variant: {
            select: {
                id: true,
                label: true,
                price: true,
                stockQuantity: true,
                isActive: true,
            },
        },
    } satisfies Prisma.DropInclude;

    private static readonly MY_CLAIM_INCLUDE = {
        drop: {
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        iconUrl: true,
                        redeemProcess: true,
                        warrantyText: true,
                        images: {
                            where: { deletedAt: null },
                            select: {
                                url: true,
                                isPrimary: true,
                                sortOrder: true,
                            },
                            orderBy: [
                                { isPrimary: 'desc' as const },
                                { sortOrder: 'asc' as const },
                            ],
                            take: 1,
                        },
                    },
                },
                variant: { select: { id: true, label: true, price: true } },
            },
        },
        vouches: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' as const },
            select: {
                id: true,
                imageUrl: true,
                caption: true,
                createdAt: true,
            },
        },
    } satisfies Prisma.DropClaimInclude;

    private mapMyClaim(row: any): MyDropClaimResponseDto {
        const primaryImage = row.drop.product.images?.[0] ?? null;
        return {
            claimId: row.id,
            referenceCode: row.referenceCode ?? null,
            dropReferenceCode: row.drop.referenceCode ?? null,
            dropId: row.dropId,
            productId: row.drop.product.id,
            variantId: row.drop.variant.id,
            productName: row.drop.product.name,
            productSlug: row.drop.product.slug,
            productIconUrl: row.drop.product.iconUrl ?? null,
            productImageUrl: primaryImage?.url ?? null,
            productRedeemProcess: row.drop.product.redeemProcess ?? null,
            productWarrantyText: row.drop.product.warrantyText ?? null,
            variantLabel: row.drop.variant.label,
            variantPrice: row.drop.variant.price?.toString() ?? '0',
            description: row.drop.description ?? null,
            claimedContent: row.claimedContent,
            claimedAt: row.claimedAt,
            expiresAt: row.drop.expiresAt ?? null,
            vouches: (row.vouches ?? []).map((vouch: any) => ({
                id: vouch.id,
                imageUrl: vouch.imageUrl ?? null,
                caption: vouch.caption ?? null,
                createdAt: vouch.createdAt,
            })),
        };
    }

    private mapDrop(row: any): DropResponseDto {
        const primaryImage = row.product.images?.[0] ?? null;
        return {
            id: row.id,
            referenceCode: row.referenceCode ?? null,
            productId: row.productId,
            variantId: row.variantId,
            product: {
                id: row.product.id,
                name: row.product.name,
                slug: row.product.slug,
                iconUrl: row.product.iconUrl ?? null,
                primaryImageUrl: primaryImage?.url ?? null,
            },
            variant: {
                id: row.variant.id,
                label: row.variant.label,
                price: row.variant.price?.toString() ?? '0',
                stockQuantity: row.variant.stockQuantity,
                isActive: row.variant.isActive,
            },
            description: row.description ?? null,
            quantity: row.quantity,
            claimedCount: row.claimedCount,
            allowedEmails: row.allowedEmails ?? [],
            expiresAt: row.expiresAt,
            daysRemaining: daysRemaining(row.expiresAt),
            status: deriveDropStatus({
                isActive: row.isActive,
                expiresAt: row.expiresAt,
                quantity: row.quantity,
                claimedCount: row.claimedCount,
            }),
            isActive: row.isActive,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    private async assertProductVariant(productId: string, variantId: string) {
        const variant = await this.databaseService.productVariant.findFirst({
            where: {
                id: variantId,
                productId,
                deletedAt: null,
            },
            select: { id: true },
        });
        if (!variant) {
            throw new HttpException(
                'drop.error.invalidProductVariant',
                HttpStatus.BAD_REQUEST
            );
        }
    }

    private normalizeExpiresAt(
        value: string | null | undefined
    ): Date | null | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (value === null) {
            return null;
        }
        return new Date(value);
    }

    private validateExpiresAt(expiresAt: Date | null | undefined): void {
        if (expiresAt && expiresAt.getTime() <= Date.now()) {
            throw new HttpException(
                'drop.error.invalidExpiry',
                HttpStatus.BAD_REQUEST
            );
        }
    }

    async create(payload: DropCreateDto): Promise<DropResponseDto> {
        await this.assertProductVariant(payload.productId, payload.variantId);
        const expiresAt = this.normalizeExpiresAt(payload.expiresAt);
        this.validateExpiresAt(expiresAt);

        const referenceCode = await generateUniqueReferenceCode(
            REFERENCE_PREFIX.DROP,
            async code =>
                !!(await this.databaseService.drop.findUnique({
                    where: { referenceCode: code },
                }))
        );

        const row = await this.databaseService.drop.create({
            data: {
                referenceCode,
                productId: payload.productId,
                variantId: payload.variantId,
                quantity: payload.quantity,
                description: payload.description ?? null,
                allowedEmails: payload.allowedEmails ?? [],
                expiresAt: expiresAt === undefined ? null : expiresAt,
                isActive: payload.isActive ?? true,
            },
            include: DropService.DROP_INCLUDE,
        });

        return this.mapDrop(row);
    }

    private buildWhere(query: DropListQueryDto): Prisma.DropWhereInput {
        const base: Prisma.DropWhereInput = { deletedAt: null };
        let where: Prisma.DropWhereInput = { ...base };

        if (query.query?.trim()) {
            where = {
                AND: [
                    where,
                    {
                        OR: [
                            {
                                product: {
                                    name: {
                                        contains: query.query.trim(),
                                        mode: 'insensitive',
                                    },
                                },
                            },
                            {
                                variant: {
                                    label: {
                                        contains: query.query.trim(),
                                        mode: 'insensitive',
                                    },
                                },
                            },
                        ],
                    },
                ],
            };
        }

        return where;
    }

    async findAll(
        query: DropListQueryDto
    ): Promise<ApiPaginatedDataDto<DropResponseDto>> {
        const page = query.page ?? 1;
        const limit = query.limit ?? 12;
        const where = this.buildWhere(query);
        const tab = query.tab ?? DropListTab.ALL;

        if (tab === DropListTab.ALL) {
            const result = await this.paginationService.paginate<any>(
                this.databaseService.drop,
                { page, limit },
                {
                    where,
                    include: {
                        product: { select: { name: true, slug: true } },
                        variant: { select: { label: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                }
            );

            return {
                metadata: result.metadata,
                items: result.items.map(row => this.mapDrop(row)),
            };
        }

        const rows = await this.databaseService.drop.findMany({
            where,
            include: DropService.DROP_INCLUDE,
            orderBy: { createdAt: 'desc' },
        });
        const mapped = rows.map(row => this.mapDrop(row));
        const filtered =
            tab === DropListTab.LIVE
                ? mapped.filter(row => row.status === 'live')
                : mapped.filter(row => row.status !== 'live');
        const start = (page - 1) * limit;
        const pagedItems = filtered.slice(start, start + limit);
        const totalPages = Math.max(1, Math.ceil(filtered.length / limit));

        return {
            metadata: {
                currentPage: page,
                itemsPerPage: limit,
                totalItems: filtered.length,
                totalPages,
            },
            items: pagedItems,
        };
    }

    async findOne(id: string): Promise<DropResponseDto> {
        const row = await this.databaseService.drop.findFirst({
            where: { id, deletedAt: null },
            include: DropService.DROP_INCLUDE,
        });
        if (!row) {
            throw new HttpException(
                'drop.error.notFound',
                HttpStatus.NOT_FOUND
            );
        }
        return this.mapDrop(row);
    }

    async update(id: string, payload: DropUpdateDto): Promise<DropResponseDto> {
        const existing = await this.databaseService.drop.findFirst({
            where: { id, deletedAt: null },
        });
        if (!existing) {
            throw new HttpException(
                'drop.error.notFound',
                HttpStatus.NOT_FOUND
            );
        }
        if (payload.productId || payload.variantId) {
            await this.assertProductVariant(
                payload.productId ?? existing.productId,
                payload.variantId ?? existing.variantId
            );
        }
        if (
            payload.quantity != null &&
            payload.quantity < existing.claimedCount
        ) {
            throw new HttpException(
                'drop.error.quantityBelowClaimed',
                HttpStatus.BAD_REQUEST
            );
        }
        const expiresAt = this.normalizeExpiresAt(payload.expiresAt);
        this.validateExpiresAt(expiresAt);

        await this.databaseService.drop.update({
            where: { id },
            data: {
                ...(payload.productId !== undefined
                    ? { productId: payload.productId }
                    : {}),
                ...(payload.variantId !== undefined
                    ? { variantId: payload.variantId }
                    : {}),
                ...(payload.quantity !== undefined
                    ? { quantity: payload.quantity }
                    : {}),
                ...(payload.description !== undefined
                    ? { description: payload.description }
                    : {}),
                ...(payload.allowedEmails !== undefined
                    ? { allowedEmails: payload.allowedEmails }
                    : {}),
                ...(expiresAt !== undefined ? { expiresAt } : {}),
                ...(payload.isActive !== undefined
                    ? { isActive: payload.isActive }
                    : {}),
            },
        });

        return this.findOne(id);
    }

    async toggleActive(id: string): Promise<DropResponseDto> {
        const existing = await this.databaseService.drop.findFirst({
            where: { id, deletedAt: null },
            select: { isActive: true },
        });
        if (!existing) {
            throw new HttpException(
                'drop.error.notFound',
                HttpStatus.NOT_FOUND
            );
        }
        await this.databaseService.drop.update({
            where: { id },
            data: { isActive: !existing.isActive },
        });
        return this.findOne(id);
    }

    async delete(id: string): Promise<ApiGenericResponseDto> {
        await this.findOne(id);
        await this.databaseService.drop.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
        return {
            success: true,
            message: 'drop.success.deleted',
        };
    }

    async listPublicLiveDrops(
        userId?: string
    ): Promise<DropPublicResponseDto[]> {
        const rows = await this.databaseService.drop.findMany({
            where: {
                isActive: true,
                deletedAt: null,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            include: DropService.DROP_INCLUDE,
            orderBy: { createdAt: 'desc' },
        });

        const liveRows = rows.filter(row => row.claimedCount < row.quantity);
        let claimedDropIds = new Set<string>();
        if (userId && liveRows.length > 0) {
            const claims = await this.databaseService.dropClaim.findMany({
                where: {
                    userId,
                    dropId: { in: liveRows.map(row => row.id) },
                },
                select: { dropId: true },
            });
            claimedDropIds = new Set(claims.map(claim => claim.dropId));
        }

        const mapped: DropPublicResponseDto[] = liveRows.map(row => ({
            id: row.id,
            product: {
                id: row.product.id,
                name: row.product.name,
                slug: row.product.slug,
                iconUrl: row.product.iconUrl ?? null,
                images: (row.product.images ?? []).map(img => ({
                    url: img.url ?? null,
                    isPrimary: img.isPrimary,
                })),
            },
            variant: {
                id: row.variant.id,
                label: row.variant.label,
            },
            description: row.description ?? null,
            quantity: row.quantity,
            claimedCount: row.claimedCount,
            hasClaimed: claimedDropIds.has(row.id),
            expiresAt: row.expiresAt,
        }));
        return mapped;
    }

    async claim(userId: string, dropId: string): Promise<DropClaimResponseDto> {
        try {
            return await this.databaseService.$transaction(
                async tx => {
                    const drop = await tx.drop.findFirst({
                        where: { id: dropId, deletedAt: null },
                        include: {
                            product: { select: { id: true, slug: true } },
                            variant: { select: { label: true } },
                        },
                    });
                    if (!drop) {
                        throw new HttpException(
                            'drop.error.notFound',
                            HttpStatus.NOT_FOUND
                        );
                    }

                    await this.stockLineService.lockVariantRow(
                        tx,
                        drop.variantId
                    );
                    await tx.$executeRawUnsafe(
                        `SELECT id FROM "drops" WHERE id = $1 FOR UPDATE`,
                        drop.id
                    );

                    if (!drop.isActive || drop.deletedAt) {
                        throw new HttpException(
                            'drop.error.inactive',
                            HttpStatus.BAD_REQUEST
                        );
                    }
                    if (
                        drop.expiresAt &&
                        drop.expiresAt.getTime() <= Date.now()
                    ) {
                        throw new HttpException(
                            'drop.error.expired',
                            HttpStatus.BAD_REQUEST
                        );
                    }
                    if (drop.claimedCount >= drop.quantity) {
                        throw new HttpException(
                            'drop.error.exhausted',
                            HttpStatus.BAD_REQUEST
                        );
                    }

                    const user = await tx.user.findUnique({
                        where: { id: userId },
                        select: { email: true },
                    });
                    if (!user) {
                        throw new HttpException(
                            'auth.error.userNotFound',
                            HttpStatus.UNAUTHORIZED
                        );
                    }
                    if (!isUserAllowed(drop.allowedEmails, user.email)) {
                        throw new HttpException(
                            'drop.error.notAllowed',
                            HttpStatus.FORBIDDEN
                        );
                    }
                    const existingClaim = await tx.dropClaim.findUnique({
                        where: {
                            dropId_userId: {
                                dropId: drop.id,
                                userId,
                            },
                        },
                        select: { id: true },
                    });
                    if (existingClaim) {
                        throw new HttpException(
                            'drop.error.alreadyClaimed',
                            HttpStatus.CONFLICT
                        );
                    }

                    const line = await tx.productStockLine.findFirst({
                        where: {
                            variantId: drop.variantId,
                            status: StockLineStatus.AVAILABLE,
                        },
                        orderBy: { createdAt: 'asc' },
                    });
                    if (!line) {
                        throw new HttpException(
                            'drop.error.exhausted',
                            HttpStatus.BAD_REQUEST
                        );
                    }

                    const decremented = await tx.drop.updateMany({
                        where: {
                            id: dropId,
                            isActive: true,
                            deletedAt: null,
                            claimedCount: { lt: drop.quantity },
                            OR: [
                                { expiresAt: null },
                                { expiresAt: { gt: new Date() } },
                            ],
                        },
                        data: { claimedCount: { increment: 1 } },
                    });
                    if (decremented.count !== 1) {
                        throw new HttpException(
                            'drop.error.exhausted',
                            HttpStatus.BAD_REQUEST
                        );
                    }

                    await tx.productStockLine.update({
                        where: { id: line.id },
                        data: {
                            status: StockLineStatus.SOLD,
                            soldAt: new Date(),
                        },
                    });
                    await tx.productVariant.update({
                        where: { id: drop.variantId },
                        data: { stockQuantity: { decrement: 1 } },
                    });

                    const claimReferenceCode =
                        await generateUniqueReferenceCode(
                            REFERENCE_PREFIX.CLAIM,
                            async code =>
                                !!(await tx.dropClaim.findUnique({
                                    where: { referenceCode: code },
                                }))
                        );

                    await tx.dropClaim.create({
                        data: {
                            referenceCode: claimReferenceCode,
                            dropId: drop.id,
                            userId,
                            stockLineId: line.id,
                            claimedContent: line.content,
                        },
                    });

                    const result = {
                        referenceCode: claimReferenceCode,
                        claimedContent: line.content,
                        productSlug: drop.product.slug,
                        productId: drop.product.id,
                        variantLabel: drop.variant.label,
                        dashboardPath: '/dashboard/drops',
                    };
                    return result;
                },
                {
                    isolationLevel:
                        Prisma.TransactionIsolationLevel.Serializable,
                }
            );
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            if (
                error instanceof PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                throw new HttpException(
                    'drop.error.alreadyClaimed',
                    HttpStatus.CONFLICT
                );
            }
            throw new HttpException(
                'drop.error.claimFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async listMyClaims(userId: string): Promise<MyDropClaimResponseDto[]> {
        const rows = await this.databaseService.dropClaim.findMany({
            where: { userId },
            include: DropService.MY_CLAIM_INCLUDE,
            orderBy: { claimedAt: 'desc' },
        });

        return rows.map(row => this.mapMyClaim(row));
    }

    async findMyClaim(
        userId: string,
        claimId: string
    ): Promise<MyDropClaimResponseDto> {
        const row = await this.databaseService.dropClaim.findFirst({
            where: { id: claimId, userId },
            include: DropService.MY_CLAIM_INCLUDE,
        });
        if (!row) {
            throw new HttpException(
                'drop.error.claimNotFound',
                HttpStatus.NOT_FOUND
            );
        }
        return this.mapMyClaim(row);
    }
}
