import { registerAs } from '@nestjs/config';

export default registerAs(
    'auth',
    (): Record<string, any> => ({
        accessToken: {
            secret: process.env.AUTH_ACCESS_TOKEN_SECRET,
            tokenExp: process.env.AUTH_ACCESS_TOKEN_EXP,
        },
        refreshToken: {
            secret: process.env.AUTH_REFRESH_TOKEN_SECRET,
            tokenExp: process.env.AUTH_REFRESH_TOKEN_EXP,
            // Extended refresh-token lifetime used when the user opts into
            // "Remember for 30 days" at login.
            rememberTokenExp:
                process.env.AUTH_REMEMBER_REFRESH_TOKEN_EXP ?? '30d',
        },
        adminLoginOtpEnabled: process.env.ADMIN_LOGIN_OTP_ENABLED !== 'false',
    })
);
