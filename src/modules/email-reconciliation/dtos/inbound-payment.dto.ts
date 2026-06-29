import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { InboundPaymentStatus, P2PProvider } from '@prisma/client';

export class InboundPaymentListQueryDto {
    @ApiPropertyOptional({ minimum: 1, default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1;

    @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit = 20;

    @ApiPropertyOptional({ enum: InboundPaymentStatus })
    @IsOptional()
    @IsEnum(InboundPaymentStatus)
    status?: InboundPaymentStatus;

    @ApiPropertyOptional({ enum: P2PProvider })
    @IsOptional()
    @IsEnum(P2PProvider)
    provider?: P2PProvider;
}

export class InboundPaymentMatchRequestDto {
    @ApiProperty({
        description:
            'Human-readable order number to credit this inbound payment to ' +
            '(the order id is also accepted).',
    })
    @IsString()
    orderNumber: string;
}

export class InboundPaymentResponseDto {
    @ApiProperty() @Expose() id: string;
    @ApiProperty({ enum: P2PProvider }) @Expose() provider: P2PProvider;
    @ApiProperty() @Expose() amount: string;
    @ApiPropertyOptional({ nullable: true }) @Expose() note: string | null;
    @ApiPropertyOptional({ nullable: true })
    @Expose()
    payerName: string | null;
    @ApiPropertyOptional({ nullable: true })
    @Expose()
    externalTxId: string | null;
    @ApiPropertyOptional({ nullable: true })
    @Expose()
    sentToHandle: string | null;
    @ApiProperty({ enum: InboundPaymentStatus })
    @Expose()
    status: InboundPaymentStatus;
    @ApiPropertyOptional({ nullable: true })
    @Expose()
    fiatPaymentId: string | null;
    @ApiPropertyOptional({ nullable: true })
    @Expose()
    orderId: string | null;
    @ApiProperty() @Expose() receivedAt: Date;
    @ApiProperty() @Expose() createdAt: Date;
}
