-- AlterTable: add per-product warranty/ticket cutoff configuration
ALTER TABLE "products"
  ADD COLUMN "warranty_minutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "ticket_cutoff_minutes" INTEGER NOT NULL DEFAULT 20;

-- AlterTable: record when the customer first viewed/revealed the delivered code
ALTER TABLE "order_items"
  ADD COLUMN "first_viewed_at" TIMESTAMP(3);
