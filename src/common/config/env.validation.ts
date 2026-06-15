import { ENV_SPEC } from './env.spec';

/** A var is "present" only if set to a non-empty (trimmed) string. */
function isPresent(raw: unknown): boolean {
    return typeof raw === 'string' && raw.trim() !== '';
}

/**
 * Boot-time validation wired into `ConfigModule.forRoot({ validate })`.
 *
 * In production a missing required var THROWS — the container crashes on start
 * and the deploy fails loudly instead of silently serving a broken app. In
 * non-production we only warn, so local/dev setups with partial env still run.
 */
export function validateEnv(
    config: Record<string, unknown>
): Record<string, unknown> {
    const isProd = (config.APP_ENV ?? process.env.APP_ENV) === 'production';

    const missing = ENV_SPEC.flatMap(g => g.vars)
        .filter(v => v.required && !isPresent(config[v.key]))
        .map(v => v.key);

    if (missing.length > 0) {
        const message =
            `[ENV] Missing required environment variable(s): ${missing.join(', ')}. ` +
            `Check the service .env / deploy/.env file.`;

        if (isProd) {
            throw new Error(message);
        }
        console.warn(`${message} (non-production: starting anyway)`);
    }

    return config;
}

export interface EnvVarReport {
    key: string;
    required: boolean;
    secret: boolean;
    present: boolean;
    /** Actual value for non-secret vars only. Secrets expose presence, never a value. */
    value?: string;
    note?: string;
}

export interface EnvGroupReport {
    group: string;
    label: string;
    vars: EnvVarReport[];
}

export interface EnvReport {
    service: string;
    env: string;
    generatedAt: string;
    ok: boolean;
    summary: {
        requiredTotal: number;
        requiredMissing: number;
        optionalSet: number;
        optionalMissing: number;
    };
    /** Keys flagged `required` that are not present — the actionable list. */
    missingRequired: string[];
    groups: EnvGroupReport[];
}

/** Truncate long non-secret values so the payload stays readable. */
function previewPlain(value: string): string {
    return value.length > 80 ? `${value.slice(0, 77)}…` : value;
}

/**
 * Build the env diagnostics report from the live `process.env`. Pure read —
 * the value of a `secret` var is NEVER included, only its presence. Safe to
 * expose publicly.
 */
export function buildEnvReport(
    source: NodeJS.ProcessEnv = process.env
): EnvReport {
    const missingRequired: string[] = [];
    let requiredTotal = 0;
    let optionalSet = 0;
    let optionalMissing = 0;

    const groups: EnvGroupReport[] = ENV_SPEC.map(group => ({
        group: group.group,
        label: group.label,
        vars: group.vars.map<EnvVarReport>(spec => {
            const raw = source[spec.key];
            const present = isPresent(raw);
            const required = !!spec.required;
            const secret = !!spec.secret;

            if (required) {
                requiredTotal += 1;
                if (!present) missingRequired.push(spec.key);
            } else if (present) {
                optionalSet += 1;
            } else {
                optionalMissing += 1;
            }

            return {
                key: spec.key,
                required,
                secret,
                present,
                // Never leak secret values; only non-secret config is shown.
                ...(present && !secret
                    ? { value: previewPlain(raw as string) }
                    : {}),
                ...(spec.note ? { note: spec.note } : {}),
            };
        }),
    }));

    return {
        service: 'jinx-be',
        env: source.APP_ENV ?? 'unknown',
        generatedAt: new Date().toISOString(),
        ok: missingRequired.length === 0,
        summary: {
            requiredTotal,
            requiredMissing: missingRequired.length,
            optionalSet,
            optionalMissing,
        },
        missingRequired,
        groups,
    };
}
