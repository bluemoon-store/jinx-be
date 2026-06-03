-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('CHIME');

-- CreateEnum
CREATE TYPE "FiatPaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "fiat_payments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "external_id" TEXT,
    "external_reference" TEXT,
    "checkout_url" TEXT,
    "status" "FiatPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "fiat_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiat_payments_order_id_key" ON "fiat_payments"("order_id");

-- CreateIndex
CREATE INDEX "fiat_payments_status_idx" ON "fiat_payments"("status");

-- CreateIndex
CREATE INDEX "fiat_payments_external_id_idx" ON "fiat_payments"("external_id");

-- CreateIndex
CREATE INDEX "fiat_payments_expires_at_idx" ON "fiat_payments"("expires_at");

-- CreateIndex
CREATE INDEX "fiat_payments_gateway_idx" ON "fiat_payments"("gateway");

-- AddForeignKey
ALTER TABLE "fiat_payments" ADD CONSTRAINT "fiat_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
