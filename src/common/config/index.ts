import AppConfig from './app.config';
import AuthConfig from './auth.config';
import CryptoConfig from './crypto.config';
import DocConfig from './doc.config';
import FirebaseConfig from './firebase.config';
import PaymentGatewayConfig from './payment-gateway.config';
import RedisConfig from './redis.config';
import ResendConfig from './resend.config';
import RenderConfig from './render.config';
import SmtpConfig from './smtp.config';
import SupabaseConfig from './supabase.config';
import TurnstileConfig from './turnstile.config';

export default [
    AppConfig,
    SupabaseConfig,
    RedisConfig,
    AuthConfig,
    DocConfig,
    FirebaseConfig,
    CryptoConfig,
    SmtpConfig,
    ResendConfig,
    PaymentGatewayConfig,
    TurnstileConfig,
    RenderConfig,
];
