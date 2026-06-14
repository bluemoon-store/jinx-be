import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { StorageModule } from '../storage/storage.module';

import { HelperEmailService } from './services/helper.email.service';
import { HelperEncryptionService } from './services/helper.encryption.service';
import { HelperPaginationService } from './services/helper.pagination.service';
import { HelperPrismaQueryBuilderService } from './services/helper.query.builder.service';
import { HelperQueryService } from './services/helper.query.service';

@Module({
    imports: [StorageModule, EmailModule, DatabaseModule],
    providers: [
        JwtService,
        HelperEncryptionService,
        HelperEmailService,
        HelperPaginationService,
        HelperPrismaQueryBuilderService,
        HelperQueryService,
    ],
    exports: [
        HelperEncryptionService,
        HelperEmailService,
        HelperPaginationService,
        HelperPrismaQueryBuilderService,
        HelperQueryService,
    ],
})
export class HelperModule {}
