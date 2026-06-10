import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';

import { SortOrder } from 'src/common/helper/dtos/query.dto';

import { ProductCreateDto } from '../dtos/request/product.create.request';
import { ProductUpdateDto } from '../dtos/request/product.update.request';
import { ProductSearchDto } from '../dtos/request/product.search.request';
import {
    ProductResponseDto,
    ProductListResponseDto,
    ProductDetailResponseDto,
} from '../dtos/response/product.response';
import {
    AdminProductVariantCreateDto,
    AdminProductVariantUpdateDto,
} from '../dtos/request/product.admin.subresource.request';

export interface IProductService {
    create(data: ProductCreateDto): Promise<ProductResponseDto>;
    findAll(options?: {
        page?: number;
        limit?: number;
        categoryId?: string;
        categorySlug?: string;
        isActive?: boolean;
        isHot?: boolean;
        isNew?: boolean;
        isRestocked?: boolean;
        sortBy?: string;
        sortOrder?: SortOrder;
    }): Promise<ApiPaginatedDataDto<ProductListResponseDto>>;
    search(
        query: ProductSearchDto
    ): Promise<ApiPaginatedDataDto<ProductListResponseDto>>;
    findOne(id: string): Promise<ProductResponseDto>;
    findBySlug(slug: string): Promise<ProductDetailResponseDto>;
    update(id: string, data: ProductUpdateDto): Promise<ProductResponseDto>;
    delete(id: string): Promise<ApiGenericResponseDto>;
    updateStock(id: string, stockQuantity: number): Promise<ProductResponseDto>;
    toggleActive(id: string): Promise<ProductResponseDto>;
    addImage(
        productId: string,
        imageKey: string,
        isPrimary?: boolean
    ): Promise<ProductResponseDto>;
    removeImage(
        productId: string,
        imageId: string
    ): Promise<ProductResponseDto>;
    setPrimaryImage(
        productId: string,
        imageId: string
    ): Promise<ProductResponseDto>;
    addVariant(
        productId: string,
        dto: AdminProductVariantCreateDto
    ): Promise<ProductResponseDto>;
    updateVariant(
        productId: string,
        variantId: string,
        dto: AdminProductVariantUpdateDto
    ): Promise<ProductResponseDto>;
    deleteVariant(
        productId: string,
        variantId: string
    ): Promise<ProductResponseDto>;
}
