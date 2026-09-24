-- CreateEnum
CREATE TYPE "fine_payer" AS ENUM ('CUSTOMER', 'COMPANY');

-- CreateEnum
CREATE TYPE "fine_status" AS ENUM ('OPEN', 'DISPUTED', 'CANCELLED', 'PAID_BY_CUSTOMER', 'PAID', 'RECOVERED', 'WAIVED');

-- AlterEnum
ALTER TYPE "charge_type" ADD VALUE 'FINE_RECOVERY';

-- CreateTable
CREATE TABLE "fines" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "customer_id" TEXT,
    "fine_number" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "occurred_on" DATE NOT NULL,
    "issued_on" DATE,
    "amount_fils" BIGINT NOT NULL,
    "payer" "fine_payer" NOT NULL,
    "status" "fine_status" NOT NULL DEFAULT 'OPEN',
    "paid_on" DATE,
    "recovery_installment_id" TEXT,
    "recovered_on" DATE,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fine_status_changes" (
    "id" TEXT NOT NULL,
    "fine_id" TEXT NOT NULL,
    "from_status" "fine_status",
    "to_status" "fine_status" NOT NULL,
    "reason" TEXT,
    "changed_by_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fine_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fines_recovery_installment_id_key" ON "fines"("recovery_installment_id");

-- CreateIndex
CREATE INDEX "fines_authority_fine_number_idx" ON "fines"("authority", "fine_number");

-- CreateIndex
CREATE INDEX "fines_vehicle_id_occurred_on_idx" ON "fines"("vehicle_id", "occurred_on");

-- CreateIndex
CREATE INDEX "fines_contract_id_idx" ON "fines"("contract_id");

-- CreateIndex
CREATE INDEX "fines_status_idx" ON "fines"("status");

-- CreateIndex
CREATE INDEX "fine_status_changes_fine_id_changed_at_idx" ON "fine_status_changes"("fine_id", "changed_at");

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_recovery_installment_id_fkey" FOREIGN KEY ("recovery_installment_id") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fine_status_changes" ADD CONSTRAINT "fine_status_changes_fine_id_fkey" FOREIGN KEY ("fine_id") REFERENCES "fines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fine_status_changes" ADD CONSTRAINT "fine_status_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A penalty is not a supply, so there is no VAT on it and no net/gross split. The only
-- rule left is that it is a real amount: a fine of nothing is a typing mistake.
ALTER TABLE "fines" ADD CONSTRAINT "fines_amount_positive"
  CHECK ("amount_fils" > 0);

-- One record per fine number per authority, among the fines that still stand. Partial,
-- like the handover forms': a record removed in error must free its number so the fine
-- can be entered again, and the same notice entered twice is a cost counted twice.
CREATE UNIQUE INDEX "fines_one_per_authority_and_number"
  ON "fines" ("authority", "fine_number")
  WHERE "deleted_at" IS NULL;

-- The ledger follows the money. A fine DrivenX has paid carries the day it paid, and one
-- it has not carries no such day — without this, a fine could report as a cost with
-- nothing to say when that cost fell, and the profit report for the month would have
-- nowhere to put it.
ALTER TABLE "fines" ADD CONSTRAINT "fines_paid_has_a_date"
  CHECK (("status" IN ('PAID', 'RECOVERED', 'WAIVED')) = ("paid_on" IS NOT NULL));

-- Recovered means an invoice was actually raised and the day it was raised is recorded.
-- A fine marked recovered with nothing invoiced is revenue DrivenX never billed.
ALTER TABLE "fines" ADD CONSTRAINT "fines_recovered_has_an_invoice"
  CHECK ("status" <> 'RECOVERED'
     OR ("recovery_installment_id" IS NOT NULL AND "recovered_on" IS NOT NULL));

-- Recharging a fine needs someone to recharge it to.
ALTER TABLE "fines" ADD CONSTRAINT "fines_recovery_has_a_customer"
  CHECK ("recovery_installment_id" IS NULL OR "customer_id" IS NOT NULL);
