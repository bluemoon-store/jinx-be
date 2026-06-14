import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, VouchStatus } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from 'src/common/database/services/database.service';
import { ENUM_FILE_STORE } from 'src/common/file/enums/files.enum';
import { HelperPaginationService } from 'src/common/helper/services/helper.pagination.service';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';
import { SupabaseStorageService } from 'src/common/storage/services/supabase.storage.service';
import { WatermarkService } from 'src/common/storage/services/watermark.service';

import { AdminVouchListQueryDto } from '../dtos/request/vouch.admin-list.request';
import { VouchCreateDto } from '../dtos/request/vouch.create.request';
import { VouchDropClaimCreateDto } from '../dtos/request/vouch.drop-claim.create.request';
import { VouchListQueryDto, VouchSort } from '../dtos/request/vouch.list.query';
import { VouchDropClaimResponseDto } from '../dtos/response/vouch.drop-claim.response';
import { VouchResponseDto } from '../dtos/response/vouch.response';
import { IVouchService } from '../interfaces/vouch.service.interface';

const MAX_VOUCHES_PER_ITEM = 5;

@Injectable()
export class VouchService implements IVouchService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly paginationService: HelperPaginationService,
        private readonly storageService: SupabaseStorageService,
        private readonly watermarkService: WatermarkService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(VouchService.name);
    }

    private readonly includeConfig = {
        user: { select: { id: true, name: true, avatar: true } },
        orderItem: {
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        images: {
                            where: { deletedAt: null },
                            orderBy: [
                                { isPrimary: 'desc' },
                                { sortOrder: 'asc' },
                            ],
                            select: { url: true },
                            take: 1,
                        },
                    },
                },
            },
        },
    } as const;

    private readonly dropClaimIncludeConfig = {
        user: { select: { id: true, name: true, avatar: true } },
        dropClaim: {
            include: {
                drop: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                                images: {
                                    where: { deletedAt: null },
                                    orderBy: [
                                        { isPrimary: 'desc' },
                                        { sortOrder: 'asc' },
                                    ],
                                    select: { url: true },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
            },
        },
    } as const;

    private getOrderBySort(sort?: VouchSort) {
        return sort === VouchSort.OLDEST
            ? { createdAt: 'asc' }
            : { createdAt: 'desc' };
    }

    private slugifyName(fileName: string): string {
        return fileName
            .toLowerCase()
            .replace(/[^a-z0-9.]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    private mapResponse(vouch: any): VouchResponseDto {
        return {
            id: vouch.id,
            orderItemId: vouch.orderItemId,
            imageUrl: vouch.imageUrl,
            caption: vouch.caption,
            status: vouch.status,
            approvedAt: vouch.approvedAt ?? null,
            createdAt: vouch.createdAt,
            user: {
                id: vouch.user.id,
                name: vouch.user.name,
                avatar: vouch.user.avatar,
            },
            product: {
                id: vouch.orderItem.product.id,
                name: vouch.orderItem.product.name,
                slug: vouch.orderItem.product.slug,
                imageUrl: vouch.orderItem.product.images[0]?.url ?? null,
            },
        };
    }

    private mapDropClaimResponse(vouch: any): VouchDropClaimResponseDto {
        return {
            id: vouch.id,
            dropClaimId: vouch.dropClaimId,
            imageUrl: vouch.imageUrl ?? null,
            caption: vouch.caption,
            createdAt: vouch.createdAt,
            user: {
                id: vouch.user.id,
                name: vouch.user.name,
                avatar: vouch.user.avatar,
            },
            product: {
                id: vouch.dropClaim.drop.product.id,
                name: vouch.dropClaim.drop.product.name,
                slug: vouch.dropClaim.drop.product.slug,
                imageUrl: vouch.dropClaim.drop.product.images[0]?.url ?? null,
            },
        };
    }

    private async uploadVouchImage(
        userId: string,
        file: Express.Multer.File,
        prefix: ENUM_FILE_STORE
    ): Promise<{ key: string; imageUrl: string }> {
        const watermarked = await this.watermarkService.applyJinxTile(
            file.buffer,
            file.mimetype
        );

        const safeName = this.slugifyName(file.originalname || 'vouch-image');
        const key = `${userId}/${prefix}/${Date.now()}_${safeName}`;

        await this.storageService.uploadObject(
            key,
            watermarked.buffer,
            watermarked.contentType
        );

        const imageUrl = this.storageService.getPublicUrl(key, 'userUploads');
        return { key, imageUrl };
    }

    public async create(
        userId: string,
        dto: VouchCreateDto,
        file: Express.Multer.File
    ): Promise<VouchResponseDto> {
        const orderItem = await this.databaseService.orderItem.findFirst({
            where: { id: dto.orderItemId },
            include: {
                order: {
                    select: { userId: true, status: true, deletedAt: true },
                },
            },
        });

        if (!orderItem || !orderItem.order || orderItem.order.deletedAt) {
            throw new HttpException(
                'vouch.error.orderItemNotFound',
                HttpStatus.NOT_FOUND
            );
        }
        if (orderItem.order.userId !== userId) {
            throw new HttpException(
                'vouch.error.forbidden',
                HttpStatus.FORBIDDEN
            );
        }
        if (
            orderItem.order.status !== OrderStatus.COMPLETED ||
            !orderItem.deliveredAt
        ) {
            throw new HttpException(
                'vouch.error.orderItemNotEligible',
                HttpStatus.BAD_REQUEST
            );
        }

        const existingCount = await this.databaseService.vouch.count({
            where: { orderItemId: dto.orderItemId, deletedAt: null },
        });
        if (existingCount >= MAX_VOUCHES_PER_ITEM) {
            throw new HttpException(
                'vouch.error.maxPerOrderItemReached',
                HttpStatus.BAD_REQUEST
            );
        }

        const { key, imageUrl } = await this.uploadVouchImage(
            userId,
            file,
            ENUM_FILE_STORE.VOUCH_IMAGES
        );
        const created = await this.databaseService.vouch.create({
            data: {
                orderItemId: dto.orderItemId,
                userId,
                imageKey: key,
                imageUrl,
                caption: dto.caption?.trim() || null,
            },
            include: this.includeConfig,
        });

        return this.mapResponse(created);
    }

    public async list(
        query: VouchListQueryDto
    ): Promise<ApiPaginatedDataDto<VouchResponseDto>> {
        const paginated = await this.paginationService.paginate<any>(
            this.databaseService.vouch,
            { page: query.page ?? 1, limit: query.limit ?? 12 },
            {
                where: {
                    deletedAt: null,
                    status: VouchStatus.APPROVED,
                },
                include: this.includeConfig,
                orderBy: this.getOrderBySort(query.sort),
            }
        );

        return {
            metadata: paginated.metadata,
            items: paginated.items.map(item => this.mapResponse(item)),
        };
    }

    public async listMine(
        userId: string,
        query: VouchListQueryDto
    ): Promise<ApiPaginatedDataDto<VouchResponseDto>> {
        const paginated = await this.paginationService.paginate<any>(
            this.databaseService.vouch,
            { page: query.page ?? 1, limit: query.limit ?? 12 },
            {
                where: { userId, deletedAt: null },
                include: this.includeConfig,
                orderBy: this.getOrderBySort(query.sort),
            }
        );

        return {
            metadata: paginated.metadata,
            items: paginated.items.map(item => this.mapResponse(item)),
        };
    }

    public async listByProduct(
        productId: string,
        query: VouchListQueryDto
    ): Promise<ApiPaginatedDataDto<VouchResponseDto>> {
        const where: Prisma.VouchWhereInput = {
            deletedAt: null,
            status: VouchStatus.APPROVED,
            orderItem: {
                productId,
            },
        };

        const paginated = await this.paginationService.paginate<any>(
            this.databaseService.vouch,
            { page: query.page ?? 1, limit: query.limit ?? 12 },
            {
                where,
                include: this.includeConfig,
                orderBy: this.getOrderBySort(query.sort),
            }
        );

        return {
            metadata: paginated.metadata,
            items: paginated.items.map(item => this.mapResponse(item)),
        };
    }

    public async deleteMine(userId: string, vouchId: string): Promise<void> {
        const vouch = await this.databaseService.vouch.findFirst({
            where: { id: vouchId, deletedAt: null },
            select: { id: true, userId: true },
        });
        if (!vouch) {
            throw new HttpException(
                'vouch.error.notFound',
                HttpStatus.NOT_FOUND
            );
        }
        if (vouch.userId !== userId) {
            throw new HttpException(
                'vouch.error.forbidden',
                HttpStatus.FORBIDDEN
            );
        }

        await this.databaseService.vouch.update({
            where: { id: vouchId },
            data: { deletedAt: new Date() },
        });
    }

    public async listAdmin(
        query: AdminVouchListQueryDto
    ): Promise<ApiPaginatedDataDto<VouchResponseDto>> {
        const where: Prisma.VouchWhereInput = {
            deletedAt: null,
            ...(query.status !== undefined ? { status: query.status } : {}),
        };

        const paginated = await this.paginationService.paginate<any>(
            this.databaseService.vouch,
            { page: query.page ?? 1, limit: query.limit ?? 10 },
            {
                where,
                include: this.includeConfig,
                orderBy: this.getOrderBySort(query.sort),
            }
        );

        return {
            metadata: paginated.metadata,
            items: paginated.items.map(item => this.mapResponse(item)),
        };
    }

    public async approveAdmin(
        vouchId: string,
        adminUserId: string
    ): Promise<VouchResponseDto> {
        const existing = await this.databaseService.vouch.findFirst({
            where: { id: vouchId, deletedAt: null },
            include: this.includeConfig,
        });
        if (!existing) {
            throw new HttpException(
                'vouch.error.notFound',
                HttpStatus.NOT_FOUND
            );
        }
        if (existing.status === VouchStatus.APPROVED) {
            return this.mapResponse(existing);
        }

        const updated = await this.databaseService.vouch.update({
            where: { id: vouchId },
            data: {
                status: VouchStatus.APPROVED,
                approvedAt: new Date(),
                approvedBy: adminUserId,
            },
            include: this.includeConfig,
        });

        return this.mapResponse(updated);
    }

    public async deleteAdmin(vouchId: string): Promise<void> {
        const vouch = await this.databaseService.vouch.findFirst({
            where: { id: vouchId, deletedAt: null },
            select: { id: true },
        });
        if (!vouch) {
            throw new HttpException(
                'vouch.error.notFound',
                HttpStatus.NOT_FOUND
            );
        }

        await this.databaseService.vouch.update({
            where: { id: vouchId },
            data: { deletedAt: new Date() },
        });
    }

    public async createForDropClaim(
        userId: string,
        dto: VouchDropClaimCreateDto,
        file: Express.Multer.File
    ): Promise<VouchDropClaimResponseDto> {
        const dropClaim = await this.databaseService.dropClaim.findFirst({
            where: { id: dto.dropClaimId },
            select: { id: true, userId: true },
        });

        if (!dropClaim) {
            throw new HttpException(
                'vouch.error.dropClaimNotFound',
                HttpStatus.NOT_FOUND
            );
        }
        if (dropClaim.userId !== userId) {
            throw new HttpException(
                'vouch.error.forbidden',
                HttpStatus.FORBIDDEN
            );
        }

        const existingCount = await this.databaseService.dropClaimVouch.count({
            where: { dropClaimId: dto.dropClaimId, deletedAt: null },
        });
        if (existingCount >= MAX_VOUCHES_PER_ITEM) {
            throw new HttpException(
                'vouch.error.maxPerDropClaimReached',
                HttpStatus.BAD_REQUEST
            );
        }

        const { key, imageUrl } = await this.uploadVouchImage(
            userId,
            file,
            ENUM_FILE_STORE.DROP_CLAIM_VOUCH_IMAGES
        );
        const created = await this.databaseService.dropClaimVouch.create({
            data: {
                dropClaimId: dto.dropClaimId,
                userId,
                imageKey: key,
                imageUrl,
                caption: dto.caption?.trim() || null,
            },
            include: this.dropClaimIncludeConfig,
        });

        return this.mapDropClaimResponse(created);
    }

    public async listByDropClaim(
        dropClaimId: string
    ): Promise<VouchDropClaimResponseDto[]> {
        const rows = await this.databaseService.dropClaimVouch.findMany({
            where: { dropClaimId, deletedAt: null },
            include: this.dropClaimIncludeConfig,
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(row => this.mapDropClaimResponse(row));
    }

    public async deleteMineDropClaim(
        userId: string,
        vouchId: string
    ): Promise<void> {
        const vouch = await this.databaseService.dropClaimVouch.findFirst({
            where: { id: vouchId, deletedAt: null },
            select: { id: true, userId: true },
        });
        if (!vouch) {
            throw new HttpException(
                'vouch.error.notFound',
                HttpStatus.NOT_FOUND
            );
        }
        if (vouch.userId !== userId) {
            throw new HttpException(
                'vouch.error.forbidden',
                HttpStatus.FORBIDDEN
            );
        }

        await this.databaseService.dropClaimVouch.update({
            where: { id: vouchId },
            data: { deletedAt: new Date() },
        });
    }
}
