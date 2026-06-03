import { registerAs } from '@nestjs/config';

export default registerAs('smtp', () => ({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? '465', 10),
    secure: process.env.SMTP_SECURE !== 'false',
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    fromEmail: process.env.SMTP_FROM_EMAIL,
    fromName: process.env.SMTP_FROM_NAME || 'Support',
}));
