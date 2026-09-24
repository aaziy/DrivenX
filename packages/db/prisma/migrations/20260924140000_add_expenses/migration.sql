-- CreateEnum
CREATE TYPE "expense_category" AS ENUM ('REGISTRATION', 'FUEL', 'TOLL', 'CLEANING', 'PARKING', 'RECOVERY', 'OVERHEAD', 'OTHER');

-- CreateEnum
CREATE TYPE "expense_allocation" AS ENUM ('VEHICLE', 'CONTRACT', 'COMPANY');

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "category" "expense_category" NOT NULL,
    "allocation" "expense_allocation" NOT NULL,
    "vehicle_id" TEXT,
    "contract_id" TEXT,
    "customer_id" TEXT,
    "incurred_on" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "supplier_name" TEXT,
    "reference_number" TEXT,
    "net_fils" BIGINT NOT NULL,
    "vat_basis_points" INTEGER NOT NULL DEFAULT 500,
    "vat_fils" BIGINT NOT NULL,
    "gross_fils" BIGINT NOT NULL,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_incurred_on_idx" ON "expenses"("incurred_on");

-- CreateIndex
CREATE INDEX "expenses_vehicle_id_incurred_on_idx" ON "expenses"("vehicle_id", "incurred_on");

-- CreateIndex
CREATE INDEX "expenses_contract_id_idx" ON "expenses"("contract_id");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- INV-10's rule again: what was paid is the net plus the VAT.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_gross_is_net_plus_vat"
  CHECK ("gross_fils" = "net_fils" + "vat_fils");

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amounts_non_negative"
  CHECK ("net_fils" >= 0 AND "vat_fils" >= 0);

-- The allocation decides which dimensions the entry carries, and a company-wide cost
-- carries none. Without this, overhead could be filed against a car and would show up in
-- that car's profitability — which is the one thing an overhead category exists to stop.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_allocation_has_its_dimensions"
  CHECK (
    ("allocation" = 'VEHICLE'  AND "vehicle_id" IS NOT NULL AND "contract_id" IS NULL)
    OR ("allocation" = 'CONTRACT' AND "contract_id" IS NOT NULL)
    OR ("allocation" = 'COMPANY'  AND "vehicle_id" IS NULL AND "contract_id" IS NULL)
  );
