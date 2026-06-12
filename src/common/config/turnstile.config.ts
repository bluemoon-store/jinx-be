import { registerAs } from '@nestjs/config';

// TEMP: hardcoded to test Turnstile without deploy env — delete after test
const TEMP_TURNSTILE_SECRET_KEY = '0x4AAAAAADi2JGmkJKj2gKa0Ou86YKJtQGE';

export default registerAs(
    'turnstile',
    (): Record<string, any> => ({
        secretKey: TEMP_TURNSTILE_SECRET_KEY,
        // secretKey: process.env.TURNSTILE_SECRET_KEY,
        enabled: true,
        // enabled: process.env.TURNSTILE_ENABLED !== 'false',
    })
);
