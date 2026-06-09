import { registerAs } from '@nestjs/config';

export default registerAs('resend', () => ({
    apiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL,
    fromName: process.env.RESEND_FROM_NAME || 'Support',
}));
