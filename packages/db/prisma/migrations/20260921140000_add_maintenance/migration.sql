-- CreateEnum
CREATE TYPE "maintenance_type" AS ENUM ('SERVICE', 'REPAIR', 'TYRES', 'INSPECTION', 'BODYWORK', 'OTHER');

-- AlterEnum
ALTER TYPE "document_owner_type" ADD VALUE 'MAINTENANCE';

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "type" "maintenance_type" NOT NULL DEFAULT 'SERVICE',
    "serviced_on" DATE NOT NULL,
    "odometer_km" INTEGER NOT NULL,
    "vendor" TEXT NOT NULL,
    "vendor_invoice_number" TEXT,
    "description" TEXT,
    "cost_net_fils" BIGINT NOT NULL,
    "vat_basis_points" INTEGER NOT NULL DEFAULT 500,
    "cost_vat_fils" BIGINT NOT NULL,
    "cost_fils" BIGINT NOT NULL,
    "next_service_on" DATE,
    "next_service_km" INTEGER,
    "contract_id" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_records_vehicle_id_serviced_on_idx" ON "maintenance_records"("vehicle_id", "serviced_on");

-- CreateIndex
CREATE INDEX "maintenance_records_next_service_on_idx" ON "maintenance_records"("next_service_on");

-- CreateIndex
CREATE INDEX "maintenance_records_next_service_km_idx" ON "maintenance_records"("next_service_km");

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The bill is a real amount, and its gross follows from its net as everywhere else.
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_cost_valid"
  CHECK ("cost_net_fils" >= 0 AND "cost_vat_fils" >= 0
         AND "cost_fils" = "cost_net_fils" + "cost_vat_fils");

-- Odometers do not run backwards, and the next service is ahead of this one.
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_odometer_non_negative"
  CHECK ("odometer_km" >= 0);

ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_next_km_ahead"
  CHECK ("next_service_km" IS NULL OR "next_service_km" > "odometer_km");

ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_next_date_ahead"
  CHECK ("next_service_on" IS NULL OR "next_service_on" > "serviced_on");
