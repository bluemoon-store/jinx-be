import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { Command } from 'nestjs-command';
import { PinoLogger } from 'nestjs-pino';
import { DatabaseService } from 'src/common/database/services/database.service';
import { generateUniqueUserNumber } from 'src/modules/user/utils/user.util';

const SEED_EMAIL = 'user@jinx.to';
const SEED_ADMIN_EMAIL = 'support@bizzjinx.com';
const SEED_PASSWORD = 'Test1234!';

@Injectable()
export class UsersSeedService {
    constructor(
        private readonly logger: PinoLogger,
        private readonly databaseService: DatabaseService
    ) {
        this.logger.setContext(UsersSeedService.name);
    }

    @Command({
        command: 'seed:users',
        describe: 'Seed one dev user (verified, full profile) + wallet',
    })
    async seed(): Promise<void> {
        const existing = await this.databaseService.user.findFirst({
            where: { email: SEED_EMAIL },
        });

        if (existing) {
            this.logger.info(
                { email: SEED_EMAIL },
                'User already exists; skipping seed'
            );
            return;
        }

        const password = await argon2.hash(SEED_PASSWORD);

        const user = await this.databaseService.user.create({
            data: {
                userName: 'seed',
                email: SEED_EMAIL,
                password,
                firstName: 'Seed',
                lastName: 'User',
                phone: '+10000000000',
                avatar: 'seed/avatars/demo-user.png',
                dateOfBirth: new Date('1990-01-15'),
                role: Role.USER,
                isVerified: true,
                isBanned: false,
                twoFactorEnabled: false,
                userNumber: await generateUniqueUserNumber(
                    this.databaseService
                ),
            },
        });

        await this.databaseService.userWallet.create({
            data: {
                userId: user.id,
                balance: 1000,
            },
        });

        this.logger.info(
            {
                userId: user.id,
                email: SEED_EMAIL,
                password: SEED_PASSWORD,
            },
            'Seeded user + wallet (password shown for local dev only)'
        );
    }

    @Command({
        command: 'seed:admin',
        describe: 'Seed primary super admin + wallet if missing',
    })
    async seedAdmin(): Promise<void> {
        const existingSuperAdmin = await this.databaseService.user.findFirst({
            where: { role: Role.SUPER_ADMIN },
        });

        if (existingSuperAdmin) {
            this.logger.info(
                {
                    userId: existingSuperAdmin.id,
                    email: existingSuperAdmin.email,
                },
                'SUPER_ADMIN already exists; skipping seed'
            );
            return;
        }

        const email = SEED_ADMIN_EMAIL;
        const password = SEED_PASSWORD;

        const hashedPassword = await argon2.hash(password);
        const userName = 'superadmin';

        const superAdmin = await this.databaseService.user.create({
            data: {
                userName,
                email: email.toLowerCase().trim(),
                password: hashedPassword,
                firstName: 'Super',
                lastName: 'Admin',
                role: Role.SUPER_ADMIN,
                isVerified: true,
                userNumber: await generateUniqueUserNumber(
                    this.databaseService
                ),
            },
        });

        await this.databaseService.userWallet.create({
            data: {
                userId: superAdmin.id,
                balance: 0,
            },
        });

        this.logger.info(
            { userId: superAdmin.id, email: superAdmin.email },
            'Seeded SUPER_ADMIN + wallet'
        );
    }
}
