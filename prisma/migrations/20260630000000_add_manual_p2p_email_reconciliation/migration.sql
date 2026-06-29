-- AlterEnum
ALTER TYPE "PaymentGateway" ADD VALUE 'MANUAL_P2P';

-- CreateEnum
CREATE TYPE "P2PProvider" AS ENUM ('CHIME', 'VENMO');

-- CreateEnum
CREATE TYPE "InboundPaymentStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- AlterTable
ALTER TABLE "fiat_payments"
  ADD COLUMN "provider" "P2PProvider",
  ADD COLUMN "destination_tag" TEXT,
  ADD COLUMN "required_note" TEXT,
  ADD COLUMN "note_key" TEXT;

-- CreateTable
CREATE TABLE "inbound_payment_emails" (
    "id" TEXT NOT NULL,
    "provider" "P2PProvider" NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "note" TEXT,
    "note_key" TEXT,
    "payer_name" TEXT,
    "external_tx_id" TEXT,
    "sent_to_handle" TEXT,
    "gmail_message_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "status" "InboundPaymentStatus" NOT NULL DEFAULT 'UNMATCHED',
    "fiat_payment_id" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_payment_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiat_payments_note_key_key" ON "fiat_payments"("note_key");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_payment_emails_external_tx_id_key" ON "inbound_payment_emails"("external_tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_payment_emails_gmail_message_id_key" ON "inbound_payment_emails"("gmail_message_id");

-- CreateIndex
CREATE INDEX "inbound_payment_emails_status_idx" ON "inbound_payment_emails"("status");

-- CreateIndex
CREATE INDEX "inbound_payment_emails_note_key_idx" ON "inbound_payment_emails"("note_key");

-- CreateIndex
CREATE INDEX "inbound_payment_emails_provider_idx" ON "inbound_payment_emails"("provider");

-- CreateIndex
CREATE INDEX "inbound_payment_emails_fiat_payment_id_idx" ON "inbound_payment_emails"("fiat_payment_id");

-- AddForeignKey
ALTER TABLE "inbound_payment_emails" ADD CONSTRAINT "inbound_payment_emails_fiat_payment_id_fkey" FOREIGN KEY ("fiat_payment_id") REFERENCES "fiat_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
