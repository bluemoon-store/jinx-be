import { registerAs } from '@nestjs/config';

export default registerAs(
    'turnstile',
    (): Record<string, any> => ({
        secretKey: '0x4AAAAAADjfRHiGNpwAPwy8uddf_Rx8mV8',
        enabled: process.env.TURNSTILE_ENABLED !== 'false',
    })
);
