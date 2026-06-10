-- DropForeignKey
ALTER TABLE "product_related" DROP CONSTRAINT IF EXISTS "product_related_product_id_fkey";

-- DropForeignKey
ALTER TABLE "product_related" DROP CONSTRAINT IF EXISTS "product_related_related_product_id_fkey";

-- DropTable
DROP TABLE "product_related";
