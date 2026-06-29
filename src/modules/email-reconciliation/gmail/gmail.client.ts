import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import axios, { AxiosInstance } from 'axios';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GmailHeader {
    name: string;
    value: string;
}

export interface GmailMessagePart {
    mimeType?: string;
    headers?: GmailHeader[];
    body?: { data?: string; size?: number };
    parts?: GmailMessagePart[];
}

export interface GmailMessage {
    id: string;
    threadId: string;
    internalDate?: string; // epoch ms as string
    payload?: GmailMessagePart;
    snippet?: string;
}

/**
 * Minimal Gmail REST client (no googleapis dependency).
 *
 * Authenticates with an OAuth2 refresh token for the notification mailbox and
 * exposes just what the reconciler needs: list message ids by query, and fetch
 * a full message. Access tokens are cached in-memory until shortly before they
 * expire. All Chime/Venmo provider quirks live in the parsers, not here.
 */
@Injectable()
export class GmailClient {
    private readonly http: AxiosInstance;
    private accessToken: string | null = null;
    private accessTokenExpiresAt = 0;

    constructor(
        private readonly configService: ConfigService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(GmailClient.name);
        this.http = axios.create({ timeout: 15_000 });
    }

    isConfigured(): boolean {
        const g = this.googleConfig();
        return !!(g.clientId && g.clientSecret && g.refreshToken);
    }

    private googleConfig(): {
        clientId: string;
        clientSecret: string;
        refreshToken: string;
    } {
        return (
            this.configService.get('paymentGateway.manualP2PEmail.google') ?? {
                clientId: '',
                clientSecret: '',
                refreshToken: '',
            }
        );
    }

    /** Exchange the refresh token for an access token, cached until ~1m before expiry. */
    private async getAccessToken(): Promise<string> {
        const now = Date.now();
        if (this.accessToken && now < this.accessTokenExpiresAt - 60_000) {
            return this.accessToken;
        }
        const { clientId, clientSecret, refreshToken } = this.googleConfig();
        const body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        });
        const { data } = await this.http.post(TOKEN_URL, body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        this.accessToken = data.access_token as string;
        this.accessTokenExpiresAt =
            now + Number(data.expires_in ?? 3600) * 1000;
        return this.accessToken;
    }

    private async authHeader(): Promise<Record<string, string>> {
        const token = await this.getAccessToken();
        return { Authorization: `Bearer ${token}` };
    }

    /**
     * List message ids matching a Gmail search query (e.g.
     * `from:(venmo.com OR chime.com) newer_than:2d`). Returns ids only — call
     * getMessage for the content.
     */
    async listMessageIds(query: string, maxResults: number): Promise<string[]> {
        const headers = await this.authHeader();
        const { data } = await this.http.get(`${GMAIL_API}/messages`, {
            headers,
            params: { q: query, maxResults },
        });
        const messages = (data.messages ?? []) as Array<{ id: string }>;
        return messages.map(m => m.id);
    }

    /** Fetch a full message (headers + body parts). */
    async getMessage(id: string): Promise<GmailMessage> {
        const headers = await this.authHeader();
        const { data } = await this.http.get(`${GMAIL_API}/messages/${id}`, {
            headers,
            params: { format: 'full' },
        });
        return data as GmailMessage;
    }
}
