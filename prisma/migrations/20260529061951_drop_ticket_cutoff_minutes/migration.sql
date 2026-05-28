-- AlterTable: drop ticket_cutoff_minutes (consolidated into warranty_minutes)
ALTER TABLE "products"
  DROP COLUMN "ticket_cutoff_minutes";
