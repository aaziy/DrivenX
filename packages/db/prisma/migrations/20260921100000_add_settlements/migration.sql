-- CreateEnum
CREATE TYPE "settlement_reason" AS ENUM ('EARLY_TERMINATION', 'END_OF_TERM', 'RETURN');

-- CreateEnum
CREATE TYPE "settlement_status" AS ENUM ('OPEN', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "settlement_line_kind" AS ENUM ('CHARGE', 'CREDIT');

-- CreateEnum
CREATE TYPE "settlement_charge_type" AS ENUM ('EXCESS_MILEAGE', 'DAMAGE', 'FEE', 'OTHER');

-- AlterEnum
ALTER TYPE "installment_status" ADD VALUE 'CANCELLED';

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "reason" "settlement_reason" NOT NULL,
    "status" "settlement_status" NOT NULL DEFAULT 'OPEN',
    "returned_mileage_km" INTEGER,
    "notes" TEXT,
    "installment_id" TEXT,
    "opened_by_id" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_by_id" TEXT,
    "settled_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_lines" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "kind" "settlement_line_kind" NOT NULL,
    "charge_type" "settlement_charge_type" NOT NULL DEFAULT 'OTHER',
    "label" TEXT NOT NULL,
    "net_fils" BIGINT NOT NULL,
    "vat_basis_points" INTEGER NOT NULL DEFAULT 500,
    "vat_fils" BIGINT NOT NULL,
    "gross_fils" BIGINT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlements_contract_id_key" ON "settlements"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_installment_id_key" ON "settlements"("installment_id");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");

-- CreateIndex
CREATE INDEX "settlement_lines_settlement_id_idx" ON "settlement_lines"("settlement_id");

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_settled_by_id_fkey" FOREIGN KEY ("settled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Every line is a real amount, and its gross follows from its net as everywhere else.
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_amounts_valid"
  CHECK ("net_fils" > 0 AND "vat_fils" >= 0 AND "gross_fils" = "net_fils" + "vat_fils");

-- A settled settlement says when it was settled; an open one has not been.
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_settled_has_date"
  CHECK (("status" = 'SETTLED') = ("settled_on" IS NOT NULL));

ALTER TABLE "settlements" ADD CONSTRAINT "settlements_mileage_non_negative"
  CHECK ("returned_mileage_km" IS NULL OR "returned_mileage_km" >= 0);
