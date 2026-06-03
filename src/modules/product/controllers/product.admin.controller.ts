import {
    Body,
    BadRequestException,
    Controller,
    Delete,
    Get,
    HttpStatus,
    Param,
    Post,
    Put,
    Query,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiQuery,
    ApiTags,
} from '@nestjs/swagger';
import { ActivityLogCategory } from '@prisma/client';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';
import { DocResponse } from 'src/common/doc/decorators/doc.response.decorator';
import { DocGenericResponse } from 'src/common/doc/decorators/doc.generic.decorator';
import { DocPaginatedResponse } from 'src/common/doc/decorators/doc.paginated.decorator';
import {
    READ_ADMIN_ROLES,
    STAFF_OPERATIONS_ROLES,
} from 'src/common/request/constants/roles.constant';
import { AllowedRoles } from 'src/common/request/decorators/request.role.decorator';
import { QueryTransformPipe } from 'src/common/request/pipes/query-transform.pipe';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';

import { CategoryCreateDto } from '../dtos/request/category.create.request';
import { CategoryUpdateDto } from '../dtos/request/category.update.request';
import { ProductCreateDto } from '../dtos/request/product.create.request';
import { ProductUpdateDto } from '../dtos/request/product.update.request';
import { ProductSearchDto } from '../dtos/request/product.search.request';
import { ProductListQueryDto } from '../dtos/request/product.list.request';
import { CategoryListQueryDto } from '../dtos/request/category.list.request';
import {
    AdminProductRelatedSetDto,
    AdminProductImageCreateDto,
    AdminProductVariantCreateDto,
    AdminProductVariantUpdateDto,
} from '../dtos/request/product.admin.subresource.request';
import {
    ProductResponseDto,
    ProductListResponseDto,
} from '../dtos/response/product.response';
import { CategoryResponseDto } from '../dtos/response/category.response';
import { ProductService } from '../services/product.service';
import { ProductCategoryService } from '../services/product-category.service';
import { AuditLog } from 'src/modules/activity-log/decorators/audit-log.decorator';

@ApiTags('admin.product')
@Controller({
    path: '/admin/products',
    version: '1',
})
export class ProductAdminController {
    constructor(
        private readonly productService: ProductService,
        private readonly categoryService: ProductCategoryService
    ) {}

    @Post()
    @AuditLog({
        action: 'product.create',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'Product',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Create product' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.CREATED,
        messageKey: 'product.success.created',
    })
    public async create(
        @Body() payload: ProductCreateDto
    ): Promise<ProductResponseDto> {
        return this.productService.create(payload);
    }

    @Get()
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'List all products (admin)' })
    @DocPaginatedResponse({
        serialization: ProductListResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.list',
    })
    public async list(
        @Query(
            new QueryTransformPipe({
                booleanFields: ['isActive', 'isHot', 'isNew', 'isRestocked'],
            })
        )
        query: ProductListQueryDto
    ): Promise<ApiPaginatedDataDto<ProductListResponseDto>> {
        return this.productService.findAll({
            page: query.page,
            limit: query.limit,
            categoryId: query.categoryId,
            categorySlug: query.categorySlug,
            isActive: query.isActive,
            isHot: query.isHot,
            isNew: query.isNew,
            isRestocked: query.isRestocked,
        });
    }

    @Get('search')
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Search products (admin)' })
    @DocPaginatedResponse({
        serialization: ProductListResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.search',
    })
    public async search(
        @Query() query: ProductSearchDto
    ): Promise<ApiPaginatedDataDto<ProductListResponseDto>> {
        return this.productService.search(query);
    }

    // Categories (must be registered before :id routes)

    @Post('categories')
    @AuditLog({
        action: 'product.category.create',
        category: ActivityLogCategory.PRODUCT_CATEGORY,
        resourceType: 'ProductCategory',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Create category' })
    @DocResponse({
        serialization: CategoryResponseDto,
        httpStatus: HttpStatus.CREATED,
        messageKey: 'product.success.categoryCreated',
    })
    public async createCategory(
        @Body() payload: CategoryCreateDto
    ): Promise<CategoryResponseDto> {
        return this.categoryService.create(payload);
    }

    @Get('categories')
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'List all categories (admin)' })
    @DocPaginatedResponse({
        serialization: CategoryResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.listCategories',
    })
    public async listCategories(
        @Query(new QueryTransformPipe()) query: CategoryListQueryDto
    ): Promise<ApiPaginatedDataDto<CategoryResponseDto>> {
        return this.categoryService.findAll({
            page: query.page,
            limit: query.limit,
            isActive: query.isActive,
        });
    }

    @Get('categories/:id')
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Get category by ID' })
    @DocResponse({
        serialization: CategoryResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.categoryFound',
    })
    public async getCategoryById(
        @Param('id') id: string
    ): Promise<CategoryResponseDto> {
        return this.categoryService.findOne(id);
    }

    @Put('categories/:id')
    @AuditLog({
        action: 'product.category.update',
        category: ActivityLogCategory.PRODUCT_CATEGORY,
        resourceType: 'ProductCategory',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Update category' })
    @DocResponse({
        serialization: CategoryResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.categoryUpdated',
    })
    public async updateCategory(
        @Param('id') id: string,
        @Body() payload: CategoryUpdateDto
    ): Promise<CategoryResponseDto> {
        return this.categoryService.update(id, payload);
    }

    @Delete('categories/:id')
    @AuditLog({
        action: 'product.category.delete',
        category: ActivityLogCategory.PRODUCT_CATEGORY,
        resourceType: 'ProductCategory',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Delete category' })
    @ApiQuery({
        name: 'reassignToCategoryId',
        required: false,
        type: String,
        description:
            'Destination category id to move products into before deleting. Required when the category has products.',
    })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.categoryDeleted',
    })
    public async deleteCategory(
        @Param('id') id: string,
        @Query('reassignToCategoryId') reassignToCategoryId?: string
    ): Promise<ApiGenericResponseDto> {
        return this.categoryService.delete(id, reassignToCategoryId);
    }

    @Put('categories/:id/toggle-active')
    @AuditLog({
        action: 'product.category.toggle.active',
        category: ActivityLogCategory.PRODUCT_CATEGORY,
        resourceType: 'ProductCategory',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Toggle category active status' })
    @DocResponse({
        serialization: CategoryResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.categoryActiveToggled',
    })
    public async toggleCategoryActive(
        @Param('id') id: string
    ): Promise<CategoryResponseDto> {
        return this.categoryService.toggleActive(id);
    }

    // Variants / regions / related

    @Post(':id/variants')
    @AuditLog({
        action: 'product.variant.create',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'ProductVariant',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Add product variant' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.updated',
    })
    public async addVariant(
        @Param('id') productId: string,
        @Body() payload: AdminProductVariantCreateDto
    ): Promise<ProductResponseDto> {
        return this.productService.addVariant(productId, payload);
    }

    @Put(':id/variants/:variantId')
    @AuditLog({
        action: 'product.variant.update',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'ProductVariant',
        resourceIdParam: 'variantId',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Update product variant' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.updated',
    })
    public async updateVariant(
        @Param('id') productId: string,
        @Param('variantId') variantId: string,
        @Body() payload: AdminProductVariantUpdateDto
    ): Promise<ProductResponseDto> {
        return this.productService.updateVariant(productId, variantId, payload);
    }

    @Delete(':id/variants/:variantId')
    @AuditLog({
        action: 'product.variant.delete',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'ProductVariant',
        resourceIdParam: 'variantId',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Remove product variant (soft delete)' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.updated',
    })
    public async deleteVariant(
        @Param('id') productId: string,
        @Param('variantId') variantId: string
    ): Promise<ProductResponseDto> {
        return this.productService.deleteVariant(productId, variantId);
    }

    @Put(':id/related')
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Set related products' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.updated',
    })
    public async setRelated(
        @Param('id') productId: string,
        @Body() payload: AdminProductRelatedSetDto
    ): Promise<ProductResponseDto> {
        return this.productService.setRelatedProducts(
            productId,
            payload.relatedProductIds
        );
    }

    // Product by ID and CRUD

    @Get(':id')
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Get product by ID (admin)' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.productFound',
    })
    public async getById(@Param('id') id: string): Promise<ProductResponseDto> {
        return this.productService.findOne(id);
    }

    @Put(':id')
    @AuditLog({
        action: 'product.update',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'Product',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Update product' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.updated',
    })
    public async update(
        @Param('id') id: string,
        @Body() payload: ProductUpdateDto
    ): Promise<ProductResponseDto> {
        return this.productService.update(id, payload);
    }

    @Delete(':id')
    @AuditLog({
        action: 'product.delete',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'Product',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Delete product' })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.productDeleted',
    })
    public async delete(
        @Param('id') id: string
    ): Promise<ApiGenericResponseDto> {
        return this.productService.delete(id);
    }

    @Put(':id/stock')
    @AuditLog({
        action: 'product.stock.adjust',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'Product',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Update product stock' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.stockUpdated',
    })
    public async updateStock(
        @Param('id') id: string,
        @Body('stockQuantity') stockQuantity: number
    ): Promise<ProductResponseDto> {
        return this.productService.updateStock(id, stockQuantity);
    }

    @Put(':id/toggle-active')
    @AuditLog({
        action: 'product.toggle.active',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'Product',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Toggle product active status' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.activeToggled',
    })
    public async toggleActive(
        @Param('id') id: string
    ): Promise<ProductResponseDto> {
        return this.productService.toggleActive(id);
    }

    @Post(':id/images')
    @AuditLog({
        action: 'product.image.add',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'Product',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Add image to product' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.imageAdded',
    })
    public async addImage(
        @Param('id') productId: string,
        @Body() payload: AdminProductImageCreateDto
    ): Promise<ProductResponseDto> {
        const imageKey = payload.key ?? payload.imageKey;
        if (!imageKey && !payload.url) {
            throw new BadRequestException('imageKey, key, or url is required');
        }
        return this.productService.addImage(
            productId,
            imageKey,
            payload.isPrimary ?? false,
            payload.url
        );
    }

    @Delete(':id/images/:imageId')
    @AuditLog({
        action: 'product.image.delete',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'ProductImage',
        resourceIdParam: 'imageId',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Remove image from product' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.imageRemoved',
    })
    public async removeImage(
        @Param('id') productId: string,
        @Param('imageId') imageId: string
    ): Promise<ProductResponseDto> {
        return this.productService.removeImage(productId, imageId);
    }

    @Put(':id/images/:imageId/primary')
    @AuditLog({
        action: 'product.image.setPrimary',
        category: ActivityLogCategory.PRODUCT,
        resourceType: 'ProductImage',
        resourceIdParam: 'imageId',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Set image as primary' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.primaryImageSet',
    })
    public async setPrimaryImage(
        @Param('id') productId: string,
        @Param('imageId') imageId: string
    ): Promise<ProductResponseDto> {
        return this.productService.setPrimaryImage(productId, imageId);
    }
}
