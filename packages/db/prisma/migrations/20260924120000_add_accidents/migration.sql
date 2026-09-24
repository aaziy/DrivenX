-- CreateEnum
CREATE TYPE "accident_status" AS ENUM ('REPORTED', 'UNDER_REPAIR', 'REPAIRED', 'WRITTEN_OFF', 'CLOSED');

-- CreateEnum
CREATE TYPE "accident_responsibility" AS ENUM ('CUSTOMER', 'THIRD_PARTY', 'SHARED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "claim_status" AS ENUM ('LODGED', 'APPROVED', 'SETTLED', 'REJECTED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "document_owner_type" ADD VALUE 'ACCIDENT';

-- CreateTable
CREATE TABLE "accidents" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "customer_id" TEXT,
    "occurred_on" DATE NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT,
    "responsibility" "accident_responsibility" NOT NULL DEFAULT 'UNKNOWN',
    "police_report_number" TEXT,
    "status" "accident_status" NOT NULL DEFAULT 'REPORTED',
    "repair_net_fils" BIGINT,
    "vat_basis_points" INTEGER NOT NULL DEFAULT 500,
    "repair_vat_fils" BIGINT,
    "repair_fils" BIGINT,
    "repair_vendor" TEXT,
    "repaired_on" DATE,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accident_status_changes" (
    "id" TEXT NOT NULL,
    "accident_id" TEXT NOT NULL,
    "from_status" "accident_status",
    "to_status" "accident_status" NOT NULL,
    "reason" TEXT,
    "changed_by_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accident_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_claims" (
    "id" TEXT NOT NULL,
    "accident_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "claim_number" TEXT NOT NULL,
    "lodged_on" DATE NOT NULL,
    "status" "claim_status" NOT NULL DEFAULT 'LODGED',
    "claimed_fils" BIGINT NOT NULL,
    "approved_fils" BIGINT,
    "received_fils" BIGINT,
    "settled_on" DATE,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_status_changes" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "from_status" "claim_status",
    "to_status" "claim_status" NOT NULL,
    "reason" TEXT,
    "changed_by_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accidents_vehicle_id_occurred_on_idx" ON "accidents"("vehicle_id", "occurred_on");

-- CreateIndex
CREATE INDEX "accidents_contract_id_idx" ON "accidents"("contract_id");

-- CreateIndex
CREATE INDEX "accidents_status_idx" ON "accidents"("status");

-- CreateIndex
CREATE INDEX "accident_status_changes_accident_id_changed_at_idx" ON "accident_status_changes"("accident_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_claims_accident_id_key" ON "insurance_claims"("accident_id");

-- CreateIndex
CREATE INDEX "insurance_claims_status_idx" ON "insurance_claims"("status");

-- CreateIndex
CREATE INDEX "claim_status_changes_claim_id_changed_at_idx" ON "claim_status_changes"("claim_id", "changed_at");

-- AddForeignKey
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accident_status_changes" ADD CONSTRAINT "accident_status_changes_accident_id_fkey" FOREIGN KEY ("accident_id") REFERENCES "accidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accident_status_changes" ADD CONSTRAINT "accident_status_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_accident_id_fkey" FOREIGN KEY ("accident_id") REFERENCES "accidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "insurance_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_status_changes" ADD CONSTRAINT "claim_status_changes_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_status_changes" ADD CONSTRAINT "claim_status_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A repair is a bill with VAT beside it, or it has not been billed yet. Half of one is a
-- cost nobody can reconcile against the garage's invoice.
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_repair_complete"
  CHECK (num_nonnulls("repair_net_fils", "repair_vat_fils", "repair_fils", "repaired_on") IN (0, 4));

ALTER TABLE "accidents" ADD CONSTRAINT "accidents_repair_non_negative"
  CHECK (("repair_net_fils" IS NULL OR "repair_net_fils" >= 0)
     AND ("repair_vat_fils" IS NULL OR "repair_vat_fils" >= 0));

-- INV-10's rule, applied to a repair: the bill is its net plus its VAT.
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_repair_is_net_plus_vat"
  CHECK ("repair_fils" IS NULL OR "repair_fils" = "repair_net_fils" + "repair_vat_fils");

ALTER TABLE "insurance_claims" ADD CONSTRAINT "claims_amounts_non_negative"
  CHECK ("claimed_fils" >= 0
     AND ("approved_fils" IS NULL OR "approved_fils" >= 0)
     AND ("received_fils" IS NULL OR "received_fils" >= 0));

-- Settled means money arrived on a day. Approved is not paid, and a claim recorded as
-- settled with nothing received is a recovery reported that never happened.
ALTER TABLE "insurance_claims" ADD CONSTRAINT "claims_settled_has_money_and_a_date"
  CHECK ("status" <> 'SETTLED'
     OR ("received_fils" IS NOT NULL AND "settled_on" IS NOT NULL));

-- One claim number per insurer, among the claims that still stand.
CREATE UNIQUE INDEX "claims_one_per_policy_and_number"
  ON "insurance_claims" ("policy_id", "claim_number")
  WHERE "deleted_at" IS NULL AND "policy_id" IS NOT NULL;
