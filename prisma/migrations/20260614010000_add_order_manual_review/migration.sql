-- AlterTable
ALTER TABLE "orders" ADD COLUMN "manually_reviewed_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "manually_reviewed_by_id" TEXT;
