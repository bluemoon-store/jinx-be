import { registerAs } from '@nestjs/config';

export default registerAs(
    'turnstile',
    (): Record<string, any> => ({
        secretKey: process.env.TURNSTILE_SECRET_KEY,
        // Enabled by default; set TURNSTILE_ENABLED="false" to bypass verification locally.
        enabled: process.env.TURNSTILE_ENABLED !== 'false',
    })
);
