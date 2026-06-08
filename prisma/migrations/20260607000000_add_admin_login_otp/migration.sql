-- AlterTable
ALTER TABLE "users" ADD COLUMN     "admin_login_otp" TEXT,
ADD COLUMN     "admin_login_otp_expiry" TIMESTAMP(3);
