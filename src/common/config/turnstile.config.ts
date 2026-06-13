import { registerAs } from '@nestjs/config';

export default registerAs(
    'turnstile',
    (): Record<string, any> => ({
        secretKey: process.env.TURNSTILE_SECRET_KEY,
        enabled: process.env.TURNSTILE_ENABLED !== 'false',
    })
);
