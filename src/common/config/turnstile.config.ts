import { registerAs } from '@nestjs/config';

export default registerAs(
    'turnstile',
    (): Record<string, any> => ({
        secretKey:
            process.env.TURNSTILE_SECRET_KEY ||
            '0x4AAAAAADjfRHiGNpwAPwy8uddf_Rx8mV8',
        enabled: process.env.TURNSTILE_ENABLED !== 'false',
    })
);
