-- CreateEnum
CREATE TYPE "contract_type" AS ENUM ('LONG_TERM_RENTAL', 'LEASE_TO_OWN', 'B2B_RENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('DRAFT', 'PENDING', 'ACTIVE', 'OVERDUE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "charge_type" AS ENUM ('MONTHLY_RENTAL', 'ANNUAL_INSURANCE', 'DOWN_PAYMENT', 'ADMIN_FEE', 'BUYOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "recurrence" AS ENUM ('ONCE', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "installment_status" AS ENUM ('UPCOMING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "ledger_direction" AS ENUM ('REVENUE', 'COST');

-- DropIndex
DROP INDEX "vehicles_code_trgm";

-- DropIndex
DROP INDEX "vehicles_plate_number_trgm";

-- DropIndex
DROP INDEX "vehicles_vin_trgm";

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "type" "contract_type" NOT NULL,
    "status" "contract_status" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "monthly_rental_fils" BIGINT NOT NULL,
    "down_payment_fils" BIGINT NOT NULL DEFAULT 0,
    "buyout_fils" BIGINT NOT NULL DEFAULT 0,
    "annual_insurance_fils" BIGINT NOT NULL DEFAULT 0,
    "vat_basis_points" INTEGER NOT NULL DEFAULT 500,
    "mileage_allowance_km" INTEGER,
    "excess_mileage_rate_fils" BIGINT,
    "terms" TEXT,
    "activated_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_charges" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "charge_type" "charge_type" NOT NULL,
    "label" TEXT NOT NULL,
    "recurrence" "recurrence" NOT NULL,
    "amount_fils" BIGINT NOT NULL,
    "starts_on" DATE NOT NULL,
    "occurrences" INTEGER NOT NULL,
    "vat_basis_points" INTEGER NOT NULL,

    CONSTRAINT "contract_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "charge_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "net_fils" BIGINT NOT NULL,
    "vat_basis_points" INTEGER NOT NULL,
    "vat_fils" BIGINT NOT NULL,
    "gross_fils" BIGINT NOT NULL,
    "paid_fils" BIGINT NOT NULL DEFAULT 0,
    "status" "installment_status" NOT NULL DEFAULT 'UPCOMING',
    "invoice_number" TEXT,
    "issued_on" DATE,
    "waived_at" TIMESTAMP(3),
    "waive_reason" TEXT,
    "waived_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "received_on" DATE NOT NULL,
    "amount_fils" BIGINT NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "credit_fils" BIGINT NOT NULL DEFAULT 0,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "installment_id" TEXT NOT NULL,
    "amount_fils" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "occurred_on" DATE NOT NULL,
    "period_month" INTEGER NOT NULL,
    "direction" "ledger_direction" NOT NULL,
    "category" TEXT NOT NULL,
    "amount_fils" BIGINT NOT NULL,
    "vehicle_id" TEXT,
    "contract_id" TEXT,
    "customer_id" TEXT,
    "supplier_id" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "reverses_id" TEXT,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "id" TEXT NOT NULL,
    "next" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_status_changes" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "from_status" "contract_status",
    "to_status" "contract_status" NOT NULL,
    "reason" TEXT,
    "changed_by_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_number_key" ON "contracts"("number");

-- CreateIndex
CREATE INDEX "contracts_status_end_date_idx" ON "contracts"("status", "end_date");

-- CreateIndex
CREATE INDEX "contracts_vehicle_id_status_idx" ON "contracts"("vehicle_id", "status");

-- CreateIndex
CREATE INDEX "contracts_customer_id_idx" ON "contracts"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_charges_contract_id_key_key" ON "contract_charges"("contract_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "installments_invoice_number_key" ON "installments"("invoice_number");

-- CreateIndex
CREATE INDEX "installments_due_date_status_idx" ON "installments"("due_date", "status");

-- CreateIndex
CREATE INDEX "installments_contract_id_due_date_idx" ON "installments"("contract_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "installments_charge_id_sequence_key" ON "installments"("charge_id", "sequence");

-- CreateIndex
CREATE INDEX "payments_contract_id_received_on_idx" ON "payments"("contract_id", "received_on");

-- CreateIndex
CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");

-- CreateIndex
CREATE INDEX "payment_allocations_installment_id_idx" ON "payment_allocations"("installment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "ledger_entries_period_month_direction_category_idx" ON "ledger_entries"("period_month", "direction", "category");

-- CreateIndex
CREATE INDEX "ledger_entries_vehicle_id_period_month_idx" ON "ledger_entries"("vehicle_id", "period_month");

-- CreateIndex
CREATE INDEX "ledger_entries_contract_id_idx" ON "ledger_entries"("contract_id");

-- CreateIndex
CREATE INDEX "ledger_entries_supplier_id_period_month_idx" ON "ledger_entries"("supplier_id", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_source_type_source_id_category_key" ON "ledger_entries"("source_type", "source_id", "category");

-- CreateIndex
CREATE INDEX "contract_status_changes_contract_id_changed_at_idx" ON "contract_status_changes"("contract_id", "changed_at");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_charges" ADD CONSTRAINT "contract_charges_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "contract_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_waived_by_id_fkey" FOREIGN KEY ("waived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_status_changes" ADD CONSTRAINT "contract_status_changes_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_status_changes" ADD CONSTRAINT "contract_status_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules the database enforces whatever writes to it (IMPLEMENTATION_PLAN §2.3).
-- ---------------------------------------------------------------------------

-- INV-7: the ledger is append-only. A mistake is corrected with a reversing entry; an
-- UPDATE or DELETE would erase the fact that the mistake was ever made. TRUNCATE is a
-- separate event and does not fire this, which is what lets the test harness reset.
CREATE FUNCTION ledger_entries_are_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (INV-7): correct it with a reversing entry';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_are_append_only();

-- Ledger amounts are positive; only a reversing entry carries a negative one.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_amount_sign"
  CHECK ("amount_fils" > 0 OR "reverses_id" IS NOT NULL);

-- INV-9: a vehicle is on at most one live contract. Two activations of the same car at the
-- same moment cannot both succeed, whichever code path they came through.
CREATE UNIQUE INDEX "contracts_one_live_contract_per_vehicle"
  ON "contracts" ("vehicle_id")
  WHERE "status" IN ('ACTIVE', 'OVERDUE') AND "deleted_at" IS NULL;

-- INV-10: an instalment's gross is its net plus its VAT.
ALTER TABLE "installments" ADD CONSTRAINT "installments_gross_is_net_plus_vat"
  CHECK ("gross_fils" = "net_fils" + "vat_fils");

-- INV-3: what is paid against an instalment is never negative and never more than it.
ALTER TABLE "installments" ADD CONSTRAINT "installments_paid_within_amount"
  CHECK ("paid_fils" >= 0 AND "paid_fils" <= "gross_fils");

ALTER TABLE "installments" ADD CONSTRAINT "installments_amounts_non_negative"
  CHECK ("net_fils" >= 0 AND "vat_fils" >= 0);

-- INV-2's other half: credit is the unplaced part of a payment, so it cannot exceed it.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_fils" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_credit_within_amount"
  CHECK ("credit_fils" >= 0 AND "credit_fils" <= "amount_fils");

ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_positive"
  CHECK ("amount_fils" > 0);

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_dates_in_order" CHECK ("end_date" >= "start_date");
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_duration_positive" CHECK ("duration_months" >= 1);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_money_non_negative"
  CHECK ("monthly_rental_fils" >= 0 AND "down_payment_fils" >= 0
     AND "buyout_fils" >= 0 AND "annual_insurance_fils" >= 0);

-- Contract numbers, CON-00001. A gap here is harmless; invoice numbers use a counter.
CREATE SEQUENCE IF NOT EXISTS contract_code_seq AS BIGINT START WITH 1 INCREMENT BY 1;
