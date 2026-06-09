-- AlterTable
ALTER TABLE "products" ADD COLUMN     "reference_code" TEXT;

-- AlterTable
ALTER TABLE "drops" ADD COLUMN     "reference_code" TEXT;

-- AlterTable
ALTER TABLE "drop_claims" ADD COLUMN     "reference_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_reference_code_key" ON "products"("reference_code");

-- CreateIndex
CREATE UNIQUE INDEX "drops_reference_code_key" ON "drops"("reference_code");

-- CreateIndex
CREATE UNIQUE INDEX "drop_claims_reference_code_key" ON "drop_claims"("reference_code");
