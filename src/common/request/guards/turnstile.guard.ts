import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
} from '@nestjs/common';
import { Request } from 'express';

import { TurnstileService } from 'src/common/auth/services/turnstile.service';

@Injectable()
export class TurnstileGuard implements CanActivate {
    constructor(private readonly turnstileService: TurnstileService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();
        const token = (request.body as { turnstileToken?: string })
            ?.turnstileToken;

        const forwardedFor = request.headers['x-forwarded-for'];
        const remoteIp =
            (request.headers['cf-connecting-ip'] as string) ||
            (Array.isArray(forwardedFor)
                ? forwardedFor[0]
                : forwardedFor?.split(',')[0]?.trim()) ||
            request.ip;

        const isValid = await this.turnstileService.verify(token, remoteIp);
        if (!isValid) {
            throw new HttpException(
                'auth.error.turnstileFailed',
                HttpStatus.BAD_REQUEST
            );
        }

        return true;
    }
}
