import {
    randomBytes,
    scrypt,
    createCipheriv,
    createDecipheriv,
} from 'node:crypto';
import { promisify } from 'node:util';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import * as argon2 from 'argon2';

import { IAuthUser } from 'src/common/request/interfaces/request.interface';

import {
    IAuthTokenResponse,
    IEncryptDataPayload,
} from '../interfaces/encryption.interface';
import { IHelperEncryptionService } from '../interfaces/encryption.service.interface';

const TWO_FACTOR_CHALLENGE_JWT_TYPE = '2fa-challenge' as const;

type TwoFactorChallengePayload = {
    userId: string;
    type: typeof TWO_FACTOR_CHALLENGE_JWT_TYPE;
    rememberMe?: boolean;
};

@Injectable()
export class HelperEncryptionService implements IHelperEncryptionService {
    private readonly logger = new Logger(HelperEncryptionService.name);
    private readonly algorithm = 'aes-256-gcm';
    private readonly keyLength = 32;
    private readonly saltLength = 16;
    private readonly ivLength = 12;
    private readonly tagLength = 16;

    private readonly accessTokenSecret: string;
    private readonly refreshTokenSecret: string;
    private readonly accessTokenExpire: string;
    private readonly refreshTokenExpire: string;
    private readonly rememberRefreshTokenExpire: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly jwtService: JwtService
    ) {
        this.accessTokenSecret = this.configService.getOrThrow<string>(
            'auth.accessToken.secret'
        );
        this.refreshTokenSecret = this.configService.getOrThrow<string>(
            'auth.refreshToken.secret'
        );
        this.accessTokenExpire = this.configService.getOrThrow<string>(
            'auth.accessToken.tokenExp'
        );
        this.refreshTokenExpire = this.configService.getOrThrow<string>(
            'auth.refreshToken.tokenExp'
        );
        this.rememberRefreshTokenExpire = this.configService.getOrThrow<string>(
            'auth.refreshToken.rememberTokenExp'
        );
    }

    public async createJwtTokens(
        payload: IAuthUser
    ): Promise<IAuthTokenResponse> {
        const [accessToken, refreshToken] = await Promise.all([
            this.createAccessToken(payload),
            this.createRefreshToken(payload),
        ]);
        return { accessToken, refreshToken };
    }

    public createAccessToken(payload: IAuthUser): Promise<string> {
        return this.jwtService.signAsync(payload, {
            secret: this.accessTokenSecret,
            expiresIn: this.accessTokenExpire as StringValue,
        });
    }

    public createRefreshToken(payload: IAuthUser): Promise<string> {
        // "Remember for 30 days" extends the refresh-token lifetime; the access
        // token stays short and is silently refreshed by the client.
        const expiresIn = payload.rememberMe
            ? this.rememberRefreshTokenExpire
            : this.refreshTokenExpire;
        return this.jwtService.signAsync(payload, {
            secret: this.refreshTokenSecret,
            expiresIn: expiresIn as StringValue,
        });
    }

    public createTwoFactorToken(
        userId: string,
        rememberMe = false
    ): Promise<string> {
        const payload: TwoFactorChallengePayload = {
            userId,
            type: TWO_FACTOR_CHALLENGE_JWT_TYPE,
            rememberMe,
        };
        return this.jwtService.signAsync(payload, {
            secret: this.accessTokenSecret,
            expiresIn: '5m',
        });
    }

    public async verifyTwoFactorToken(token: string): Promise<{
        userId: string;
        rememberMe: boolean;
    }> {
        try {
            const payload = await this.jwtService.verifyAsync<
                TwoFactorChallengePayload & Record<string, unknown>
            >(token, {
                secret: this.accessTokenSecret,
            });
            if (
                payload.type !== TWO_FACTOR_CHALLENGE_JWT_TYPE ||
                typeof payload.userId !== 'string' ||
                !payload.userId
            ) {
                throw new UnauthorizedException(
                    'auth.error.twoFactorChallengeInvalid'
                );
            }
            return {
                userId: payload.userId,
                rememberMe: payload.rememberMe === true,
            };
        } catch (error) {
            if (error instanceof UnauthorizedException) {
                throw error;
            }
            throw new UnauthorizedException(
                'auth.error.twoFactorChallengeInvalid'
            );
        }
    }

    public createHash(password: string): Promise<string> {
        return argon2.hash(password);
    }

    public match(hash: string, password: string): Promise<boolean> {
        return argon2.verify(hash, password);
    }

    public async encrypt(text: string): Promise<IEncryptDataPayload> {
        const salt = randomBytes(this.saltLength);
        const iv = randomBytes(this.ivLength);
        const key = await this.deriveKey(this.accessTokenSecret, salt);

        const cipher = createCipheriv(this.algorithm, key, iv, {
            authTagLength: this.tagLength,
        });
        const encrypted = Buffer.concat([
            cipher.update(text, 'utf8'),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();

        return {
            iv: iv.toString('hex'),
            data: encrypted.toString('hex'),
            tag: tag.toString('hex'),
            salt: salt.toString('hex'),
        };
    }

    public async decrypt({
        data,
        iv,
        tag,
        salt,
    }: IEncryptDataPayload): Promise<string> {
        try {
            const key = await this.deriveKey(
                this.accessTokenSecret,
                Buffer.from(salt, 'hex')
            );
            const decipher = createDecipheriv(
                this.algorithm,
                key,
                Buffer.from(iv, 'hex'),
                {
                    authTagLength: this.tagLength,
                }
            );
            decipher.setAuthTag(Buffer.from(tag, 'hex'));

            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(data, 'hex')),
                decipher.final(),
            ]);

            return decrypted.toString('utf8');
        } catch (error) {
            throw error;
        }
    }

    private async deriveKey(secret: string, salt: Buffer): Promise<Buffer> {
        const scryptAsync = promisify(scrypt);
        return scryptAsync(secret, salt, this.keyLength) as Promise<Buffer>;
    }
}
