-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('STANDARD', 'ACCOUNT', 'GIFT_CARD');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "type" "ProductType" NOT NULL DEFAULT 'STANDARD';

-- CreateIndex
CREATE INDEX "products_type_idx" ON "products"("type");
