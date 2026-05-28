import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import { ProductCategory } from '@prisma/client';
import { Expose } from 'class-transformer';
import {
    IsString,
    IsBoolean,
    IsInt,
    IsDate,
    IsOptional,
    IsUUID,
} from 'class-validator';

export class CategoryResponseDto implements ProductCategory {
    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({
        example: faker.commerce.department(),
    })
    @Expose()
    @IsString()
    name: string;

    @ApiProperty({
        example: faker.helpers.slugify(faker.commerce.department()),
    })
    @Expose()
    @IsString()
    slug: string;

    @ApiPropertyOptional({
        example: faker.lorem.paragraph(),
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    description: string | null;

    @ApiPropertyOptional({
        example: 'categories/icons/electronics.png',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    icon: string | null;

    @ApiProperty({
        example: true,
    })
    @Expose()
    @IsBoolean()
    isActive: boolean;

    @ApiProperty({
        example: 0,
    })
    @Expose()
    @IsInt()
    sortOrder: number;

    @ApiProperty({
        example: faker.date.past().toISOString(),
    })
    @Expose()
    @IsDate()
    createdAt: Date;

    @ApiProperty({
        example: faker.date.recent().toISOString(),
    })
    @Expose()
    @IsDate()
    updatedAt: Date;

    @ApiPropertyOptional({
        example: null,
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsDate()
    deletedAt: Date | null;

    @ApiPropertyOptional({
        example: 12,
        description: 'Number of non-deleted products in this category',
    })
    @Expose()
    @IsOptional()
    @IsInt()
    productCount?: number;
}
