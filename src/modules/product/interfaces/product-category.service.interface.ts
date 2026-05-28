import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';

import { CategoryCreateDto } from '../dtos/request/category.create.request';
import { CategoryUpdateDto } from '../dtos/request/category.update.request';
import { CategoryResponseDto } from '../dtos/response/category.response';

export interface IProductCategoryService {
    create(data: CategoryCreateDto): Promise<CategoryResponseDto>;
    findAll(options?: {
        page?: number;
        limit?: number;
        isActive?: boolean;
    }): Promise<ApiPaginatedDataDto<CategoryResponseDto>>;
    findOne(id: string): Promise<CategoryResponseDto>;
    findBySlug(slug: string): Promise<CategoryResponseDto>;
    update(id: string, data: CategoryUpdateDto): Promise<CategoryResponseDto>;
    delete(
        id: string,
        reassignToCategoryId?: string
    ): Promise<ApiGenericResponseDto>;
    toggleActive(id: string): Promise<CategoryResponseDto>;
}
