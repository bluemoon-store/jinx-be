import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';
import { DocResponse } from 'src/common/doc/decorators/doc.response.decorator';
import { DocPaginatedResponse } from 'src/common/doc/decorators/doc.paginated.decorator';
import { PublicRoute } from 'src/common/request/decorators/request.public.decorator';
import { QueryTransformPipe } from 'src/common/request/pipes/query-transform.pipe';

import { ProductSearchDto } from '../dtos/request/product.search.request';
import { ProductListQueryDto } from '../dtos/request/product.list.request';
import { CategoryListQueryDto } from '../dtos/request/category.list.request';
import {
    ProductResponseDto,
    ProductListResponseDto,
    ProductDetailResponseDto,
} from '../dtos/response/product.response';
import { CategoryResponseDto } from '../dtos/response/category.response';
import { ProductService } from '../services/product.service';
import { ProductCategoryService } from '../services/product-category.service';

@ApiTags('public.product')
@Controller({
    path: '/products',
    version: '1',
})
export class ProductPublicController {
    constructor(
        private readonly productService: ProductService,
        private readonly categoryService: ProductCategoryService
    ) {}

    @Get()
    @PublicRoute()
    @ApiOperation({ summary: 'List products' })
    @DocPaginatedResponse({
        serialization: ProductListResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.list',
    })
    public async list(
        @Query(new QueryTransformPipe()) query: ProductListQueryDto
    ): Promise<ApiPaginatedDataDto<ProductListResponseDto>> {
        return this.productService.findAll({
            page: query.page,
            limit: query.limit,
            categoryId: query.categoryId,
            categorySlug: query.categorySlug,
            type: query.type,
            isActive: query.isActive ?? true,
            isHot: query.isHot,
            isNew: query.isNew,
            isRestocked: query.isRestocked,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
        });
    }

    @Get('search')
    @PublicRoute()
    @ApiOperation({ summary: 'Search products with filters' })
    @DocPaginatedResponse({
        serialization: ProductListResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.search',
    })
    public async search(
        @Query() query: ProductSearchDto
    ): Promise<ApiPaginatedDataDto<ProductListResponseDto>> {
        const q = { ...query };
        if (q.isActive === undefined) {
            q.isActive = true;
        }
        return this.productService.search(q);
    }

    @Get('categories')
    @PublicRoute()
    @ApiOperation({ summary: 'List product categories' })
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

    @Get('categories/:slug')
    @PublicRoute()
    @ApiOperation({ summary: 'Get category by slug' })
    @DocResponse({
        serialization: CategoryResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.categoryFound',
    })
    public async getCategoryBySlug(
        @Param('slug') slug: string
    ): Promise<CategoryResponseDto> {
        return this.categoryService.findBySlug(slug);
    }

    @Get('categories/:id/products')
    @PublicRoute()
    @ApiOperation({ summary: 'Get products by category' })
    @DocPaginatedResponse({
        serialization: ProductListResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.listByCategory',
    })
    public async getProductsByCategory(
        @Param('id') categoryId: string,
        @Query(new QueryTransformPipe())
        query: Pick<ProductListQueryDto, 'page' | 'limit'>
    ): Promise<ApiPaginatedDataDto<ProductListResponseDto>> {
        return this.productService.findAll({
            page: query.page,
            limit: query.limit,
            categoryId,
            isActive: true,
        });
    }

    @Get('slug/:slug')
    @PublicRoute()
    @ApiOperation({ summary: 'Get product by slug (detail)' })
    @DocResponse({
        serialization: ProductDetailResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.productFound',
    })
    public async getBySlug(
        @Param('slug') slug: string
    ): Promise<ProductDetailResponseDto> {
        return this.productService.findBySlug(slug);
    }

    @Get(':id')
    @PublicRoute()
    @ApiOperation({ summary: 'Get product by ID' })
    @DocResponse({
        serialization: ProductResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'product.success.productFound',
    })
    public async getById(@Param('id') id: string): Promise<ProductResponseDto> {
        return this.productService.findOne(id);
    }
}
