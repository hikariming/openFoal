-- Add password hash column for Argon2id
ALTER TABLE "accounts"
ADD COLUMN IF NOT EXISTS "password_hash" TEXT;

-- Ensure account email is unique for login
DROP INDEX IF EXISTS "account_email_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "account_email_key" ON "accounts"("email");

-- Converge tenant role enum to ADMIN/MEMBER
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantAccountRole')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantAccountRole_old') THEN
    ALTER TYPE "TenantAccountRole" RENAME TO "TenantAccountRole_old";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantAccountRole') THEN
    CREATE TYPE "TenantAccountRole" AS ENUM ('ADMIN', 'MEMBER');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'tenant_account_joins'
      AND column_name = 'role'
      AND udt_name = 'TenantAccountRole_old'
  ) THEN
    ALTER TABLE "tenant_account_joins"
    ADD COLUMN "role_new" "TenantAccountRole" NOT NULL DEFAULT 'MEMBER';

    UPDATE "tenant_account_joins"
    SET "role_new" = CASE
      WHEN "role"::text IN ('OWNER', 'ADMIN') THEN 'ADMIN'::"TenantAccountRole"
      ELSE 'MEMBER'::"TenantAccountRole"
    END;

    ALTER TABLE "tenant_account_joins" DROP COLUMN "role";
    ALTER TABLE "tenant_account_joins" RENAME COLUMN "role_new" TO "role";
    ALTER TABLE "tenant_account_joins" ALTER COLUMN "role" SET DEFAULT 'MEMBER';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantAccountRole_old') THEN
    DROP TYPE "TenantAccountRole_old";
  END IF;
END $$;
