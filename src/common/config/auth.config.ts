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
        },
        adminLoginOtpEnabled: process.env.ADMIN_LOGIN_OTP_ENABLED !== 'false',
    })
);
