-- AlterTable
ALTER TABLE "products" ADD COLUMN "created_by_id" TEXT;

-- CreateIndex
CREATE INDEX "products_created_by_id_idx" ON "products"("created_by_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
