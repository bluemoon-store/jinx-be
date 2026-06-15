import { Role } from '@prisma/client';

export interface IAuthUser {
    userId: string;
    role: Role;
    /**
     * When true, the session was created with "Remember for 30 days" — the
     * refresh token gets an extended lifetime. Rides in the JWT payload so it
     * survives token refresh.
     */
    rememberMe?: boolean;
}

export interface IRequest {
    user?: IAuthUser;
}
