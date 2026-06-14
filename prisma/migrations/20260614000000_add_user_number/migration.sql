-- Add a compact, branded display identifier for users (e.g. JINX-USR-738291045).
ALTER TABLE "users" ADD COLUMN "user_number" TEXT;

-- Backfill existing rows with sequential numbers so the unique index below never
-- collides (new users get a random code at the application layer).
WITH n AS (
    SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn
    FROM "users"
    WHERE "user_number" IS NULL
)
UPDATE "users" u
    SET "user_number" = 'JINX-USR-' || lpad((100000000 + n.rn)::text, 9, '0')
    FROM n
    WHERE u."id" = n."id";

CREATE UNIQUE INDEX "users_user_number_key" ON "users"("user_number");
