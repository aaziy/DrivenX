-- CreateEnum
CREATE TYPE "insurance_coverage" AS ENUM ('COMPREHENSIVE', 'THIRD_PARTY');

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "policy_number" TEXT NOT NULL,
    "coverage" "insurance_coverage" NOT NULL DEFAULT 'COMPREHENSIVE',
    "start_date" DATE NOT NULL,
    "expiry_date" DATE NOT NULL,
    "premium_net_fils" BIGINT NOT NULL,
    "vat_basis_points" INTEGER NOT NULL DEFAULT 500,
    "premium_vat_fils" BIGINT NOT NULL,
    "premium_fils" BIGINT NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "refund_fils" BIGINT,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_policies_vehicle_id_expiry_date_idx" ON "insurance_policies"("vehicle_id", "expiry_date");

-- CreateIndex
CREATE INDEX "insurance_policies_expiry_date_idx" ON "insurance_policies"("expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_policies_provider_policy_number_key" ON "insurance_policies"("provider", "policy_number");

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The premium is the insurer's invoice: net plus its VAT, which is what is paid.
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_premium_valid"
  CHECK ("premium_net_fils" > 0 AND "premium_vat_fils" >= 0
         AND "premium_fils" = "premium_net_fils" + "premium_vat_fils");

-- Cover runs forwards, and a refund never exceeds what was paid.
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_dates_in_order"
  CHECK ("start_date" < "expiry_date");

ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_refund_within_premium"
  CHECK ("refund_fils" IS NULL OR ("refund_fils" >= 0 AND "refund_fils" <= "premium_fils"));

-- A cancelled policy says why.
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_cancel_needs_reason"
  CHECK ("cancelled_at" IS NULL OR ("cancel_reason" IS NOT NULL AND length(trim("cancel_reason")) > 0));
