import { HttpStatus, Injectable, HttpException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from 'src/common/database/services/database.service';
import { HelperPaginationService } from 'src/common/helper/services/helper.pagination.service';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';

import { CategoryCreateDto } from '../dtos/request/category.create.request';
import { CategoryUpdateDto } from '../dtos/request/category.update.request';
import { CategoryResponseDto } from '../dtos/response/category.response';
import { IProductCategoryService } from '../interfaces/product-category.service.interface';
import { generateSlug } from '../utils/product.util';
import { ActivityLogEmitterService } from 'src/modules/activity-log/services/activity-log.emitter.service';

@Injectable()
export class ProductCategoryService implements IProductCategoryService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly paginationService: HelperPaginationService,
        private readonly activityLogEmitter: ActivityLogEmitterService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(ProductCategoryService.name);
    }

    private async ensureUniqueSlug(
        baseSlug: string,
        excludeId?: string
    ): Promise<string> {
        let slug = baseSlug;
        let counter = 1;

        while (true) {
            const existing =
                await this.databaseService.productCategory.findFirst({
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

    async create(data: CategoryCreateDto): Promise<CategoryResponseDto> {
        try {
            const slug = data.slug
                ? await this.ensureUniqueSlug(generateSlug(data.slug))
                : await this.ensureUniqueSlug(generateSlug(data.name));

            // Check if name is unique
            const existingByName =
                await this.databaseService.productCategory.findFirst({
                    where: {
                        name: data.name,
                        deletedAt: null,
                    },
                });

            if (existingByName) {
                throw new HttpException(
                    'product.error.categoryNameExists',
                    HttpStatus.CONFLICT
                );
            }

            const category = await this.databaseService.productCategory.create({
                data: {
                    name: data.name,
                    slug,
                    description: data.description,
                    icon: data.icon,
                    isActive: data.isActive ?? true,
                    sortOrder: data.sortOrder ?? 0,
                },
            });

            this.logger.info({ categoryId: category.id }, 'Category created');
            return category;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to create category: ${error.message}`);
            throw new HttpException(
                'product.error.createCategoryFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async findAll(options?: {
        page?: number;
        limit?: number;
        isActive?: boolean;
    }): Promise<ApiPaginatedDataDto<CategoryResponseDto>> {
        try {
            const where: any = {
                deletedAt: null,
            };

            if (options?.isActive !== undefined) {
                where.isActive = options.isActive;
            }

            const result = await this.paginationService.paginate<
                CategoryResponseDto & {
                    _count?: { products: number };
                }
            >(
                this.databaseService.productCategory,
                {
                    page: options?.page ?? 1,
                    limit: options?.limit ?? 10,
                },
                {
                    where,
                    orderBy: [
                        { sortOrder: 'asc' as const },
                        { createdAt: 'desc' as const },
                    ],
                    include: {
                        _count: {
                            select: {
                                products: {
                                    where: { deletedAt: null },
                                },
                            },
                        },
                    },
                }
            );

            return {
                metadata: result.metadata,
                items: result.items.map(({ _count, ...rest }) => ({
                    ...rest,
                    productCount: _count?.products ?? 0,
                })),
            };
        } catch (error) {
            this.logger.error(`Failed to list categories: ${error.message}`);
            throw new HttpException(
                'product.error.listCategoriesFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async findOne(id: string): Promise<CategoryResponseDto> {
        try {
            const category =
                await this.databaseService.productCategory.findFirst({
                    where: {
                        id,
                        deletedAt: null,
                    },
                    include: {
                        _count: {
                            select: {
                                products: {
                                    where: { deletedAt: null },
                                },
                            },
                        },
                    },
                });

            if (!category) {
                throw new HttpException(
                    'product.error.categoryNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            const { _count, ...rest } = category;
            return { ...rest, productCount: _count?.products ?? 0 };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to find category: ${error.message}`);
            throw new HttpException(
                'product.error.findCategoryFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async findBySlug(slug: string): Promise<CategoryResponseDto> {
        try {
            const category =
                await this.databaseService.productCategory.findFirst({
                    where: {
                        slug,
                        deletedAt: null,
                    },
                    include: {
                        _count: {
                            select: {
                                products: {
                                    where: { deletedAt: null },
                                },
                            },
                        },
                    },
                });

            if (!category) {
                throw new HttpException(
                    'product.error.categoryNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            const { _count, ...rest } = category;
            return { ...rest, productCount: _count?.products ?? 0 };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(
                `Failed to find category by slug: ${error.message}`
            );
            throw new HttpException(
                'product.error.findCategoryFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async update(
        id: string,
        data: CategoryUpdateDto
    ): Promise<CategoryResponseDto> {
        try {
            // Check if category exists
            const existing = await this.findOne(id);

            // Check if name is unique (if being updated)
            if (data.name && data.name !== existing.name) {
                const existingByName =
                    await this.databaseService.productCategory.findFirst({
                        where: {
                            name: data.name,
                            id: { not: id },
                            deletedAt: null,
                        },
                    });

                if (existingByName) {
                    throw new HttpException(
                        'product.error.categoryNameExists',
                        HttpStatus.CONFLICT
                    );
                }
            }

            let slug = data.slug;
            if (data.name && !data.slug) {
                slug = await this.ensureUniqueSlug(generateSlug(data.name), id);
            } else if (data.slug) {
                slug = await this.ensureUniqueSlug(generateSlug(data.slug), id);
            }

            const updateData: any = { ...data };
            if (slug) {
                updateData.slug = slug;
            }

            const category = await this.databaseService.productCategory.update({
                where: { id },
                data: updateData,
            });

            this.logger.info({ categoryId: id }, 'Category updated');
            return category;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to update category: ${error.message}`);
            throw new HttpException(
                'product.error.updateCategoryFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async delete(
        id: string,
        reassignToCategoryId?: string
    ): Promise<ApiGenericResponseDto> {
        try {
            await this.findOne(id);

            const productCount = await this.databaseService.product.count({
                where: {
                    categoryId: id,
                    deletedAt: null,
                },
            });

            if (productCount > 0) {
                if (!reassignToCategoryId) {
                    throw new HttpException(
                        'product.error.reassignTargetRequired',
                        HttpStatus.BAD_REQUEST
                    );
                }
                if (reassignToCategoryId === id) {
                    throw new HttpException(
                        'product.error.reassignTargetSameAsSource',
                        HttpStatus.BAD_REQUEST
                    );
                }
                // Throws categoryNotFound (404) if missing or soft-deleted
                await this.findOne(reassignToCategoryId);
            }

            let movedCount = 0;
            await this.databaseService.$transaction(async tx => {
                if (productCount > 0 && reassignToCategoryId) {
                    const updateResult = await tx.product.updateMany({
                        where: {
                            categoryId: id,
                            deletedAt: null,
                        },
                        data: { categoryId: reassignToCategoryId },
                    });
                    movedCount = updateResult.count;
                }
                await tx.productCategory.update({
                    where: { id },
                    data: { deletedAt: new Date() },
                });
            });

            this.logger.info(
                { categoryId: id, reassignToCategoryId, movedCount },
                'Category deleted'
            );
            return {
                success: true,
                message: 'product.success.categoryDeleted',
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to delete category: ${error.message}`);
            throw new HttpException(
                'product.error.deleteCategoryFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async toggleActive(id: string): Promise<CategoryResponseDto> {
        try {
            const category = await this.findOne(id);

            this.activityLogEmitter.captureBefore({
                before: { isActive: category.isActive },
            });

            const updated = await this.databaseService.productCategory.update({
                where: { id },
                data: {
                    isActive: !category.isActive,
                },
            });

            this.logger.info(
                { categoryId: id, isActive: updated.isActive },
                'Category active status toggled'
            );

            this.activityLogEmitter.captureAfter({
                after: { isActive: updated.isActive },
                resourceLabel: category.name,
            });

            return updated;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(
                `Failed to toggle category active status: ${error.message}`
            );
            throw new HttpException(
                'product.error.toggleCategoryActiveFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}
