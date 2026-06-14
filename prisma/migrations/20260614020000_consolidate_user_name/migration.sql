-- Consolidate user identity to a single `name` column.
-- Drops the separate `userName` login handle and the `first_name`/`last_name`
-- pair. Login is by email everywhere, so `userName` was never an auth
-- credential; it is folded into `name` along with first/last.

-- 1. Add the new column (nullable for the backfill).
ALTER TABLE "users" ADD COLUMN "name" TEXT;

-- 2. Backfill: prefer "first last", then the old userName, then the email
--    local-part. COALESCE + NULLIF guarantees a non-empty value for every row.
UPDATE "users"
SET "name" = COALESCE(
    NULLIF(TRIM(CONCAT_WS(' ', "first_name", "last_name")), ''),
    NULLIF(TRIM("userName"), ''),
    split_part("email", '@', 1)
);

-- 3. Enforce NOT NULL now that every row has a value.
ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;

-- 4. Drop the old unique handle index and the three legacy columns.
DROP INDEX IF EXISTS "users_userName_key";
ALTER TABLE "users"
    DROP COLUMN "userName",
    DROP COLUMN "first_name",
    DROP COLUMN "last_name";
