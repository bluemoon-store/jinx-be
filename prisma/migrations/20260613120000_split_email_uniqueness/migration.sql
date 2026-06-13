-- Drop the global email unique index (drops the "one email == one account" assumption).
DROP INDEX IF EXISTS "users_email_key";

-- At most one LIVE customer (USER) account per email.
CREATE UNIQUE INDEX "users_email_customer_unique"
    ON "users" ("email")
    WHERE "role" = 'USER' AND "deleted_at" IS NULL;

-- At most one LIVE team (non-USER) account per email.
CREATE UNIQUE INDEX "users_email_team_unique"
    ON "users" ("email")
    WHERE "role" <> 'USER' AND "deleted_at" IS NULL;

-- Plain index to keep email lookups fast (findFirst by email).
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
