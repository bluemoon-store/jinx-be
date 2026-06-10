import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PinoLogger } from 'nestjs-pino';

const SITEVERIFY_URL =
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteVerifyResponse {
    success: boolean;
    'error-codes'?: string[];
}

@Injectable()
export class TurnstileService {
    constructor(
        private readonly configService: ConfigService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(TurnstileService.name);
    }

    /**
     * Verifies a Cloudflare Turnstile token against the siteverify API.
     * Returns true (skips verification) when disabled or no secret is configured
     * so local/unconfigured environments are not blocked.
     */
    async verify(
        token: string | undefined,
        remoteIp?: string
    ): Promise<boolean> {
        const enabled =
            this.configService.get<boolean>('turnstile.enabled') ?? true;
        const secretKey = this.configService.get<string>('turnstile.secretKey');

        if (!enabled || !secretKey) {
            return true;
        }

        if (!token) {
            return false;
        }

        try {
            const params = new URLSearchParams();
            params.append('secret', secretKey);
            params.append('response', token);
            if (remoteIp) {
                params.append('remoteip', remoteIp);
            }

            const { data } = await axios.post<SiteVerifyResponse>(
                SITEVERIFY_URL,
                params,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    timeout: 10000,
                }
            );

            if (!data.success) {
                this.logger.warn(
                    { errorCodes: data['error-codes'] },
                    'Turnstile verification rejected'
                );
            }

            return data.success === true;
        } catch (error) {
            this.logger.error(
                `Turnstile verification request failed: ${error.message}`
            );
            return false;
        }
    }
}
