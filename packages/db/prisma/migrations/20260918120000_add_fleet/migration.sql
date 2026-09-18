-- CreateEnum
CREATE TYPE "ownership_type" AS ENUM ('COMPANY_OWNED', 'B2B_SUPPLIER');

-- CreateEnum
CREATE TYPE "vehicle_status" AS ENUM ('AVAILABLE', 'RESERVED', 'RENTED', 'LEASE_TO_OWN', 'MAINTENANCE', 'ACCIDENT', 'RETURNED', 'SOLD', 'INACTIVE');

-- CreateEnum
CREATE TYPE "emirate" AS ENUM ('ABU_DHABI', 'DUBAI', 'SHARJAH', 'AJMAN', 'UMM_AL_QUWAIN', 'RAS_AL_KHAIMAH', 'FUJAIRAH');

-- DropIndex
DROP INDEX "customers_code_trgm";

-- DropIndex
DROP INDEX "customers_email_trgm";

-- DropIndex
DROP INDEX "customers_full_name_trgm";

-- DropIndex
DROP INDEX "customers_mobile_trgm";

-- DropIndex
DROP INDEX "documents_document_number_trgm";

-- DropIndex
DROP INDEX "suppliers_code_trgm";

-- DropIndex
DROP INDEX "suppliers_company_name_trgm";

-- DropIndex
DROP INDEX "suppliers_contact_person_trgm";

-- DropIndex
DROP INDEX "suppliers_trn_trgm";

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "variant" TEXT,
    "colour" TEXT,
    "plate_emirate" "emirate" NOT NULL DEFAULT 'DUBAI',
    "plate_code" TEXT NOT NULL,
    "plate_number" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "current_mileage_km" INTEGER NOT NULL DEFAULT 0,
    "ownership_type" "ownership_type" NOT NULL,
    "supplier_id" TEXT,
    "source_date" TIMESTAMP(3),
    "purchase_price_fils" BIGINT,
    "supplier_monthly_cost_fils" BIGINT,
    "status" "vehicle_status" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_status_changes" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "from_status" "vehicle_status",
    "to_status" "vehicle_status" NOT NULL,
    "reason" TEXT,
    "changed_by_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mileage_readings" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "reading_km" INTEGER NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mileage_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_code_key" ON "vehicles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vin_key" ON "vehicles"("vin");

-- CreateIndex
CREATE INDEX "vehicles_status_ownership_type_idx" ON "vehicles"("status", "ownership_type");

-- CreateIndex
CREATE INDEX "vehicles_supplier_id_idx" ON "vehicles"("supplier_id");

-- CreateIndex
CREATE INDEX "vehicles_make_model_idx" ON "vehicles"("make", "model");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_emirate_plate_code_plate_number_key" ON "vehicles"("plate_emirate", "plate_code", "plate_number");

-- CreateIndex
CREATE INDEX "vehicle_status_changes_vehicle_id_changed_at_idx" ON "vehicle_status_changes"("vehicle_id", "changed_at");

-- CreateIndex
CREATE INDEX "mileage_readings_vehicle_id_read_at_idx" ON "mileage_readings"("vehicle_id", "read_at");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_status_changes" ADD CONSTRAINT "vehicle_status_changes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_status_changes" ADD CONSTRAINT "vehicle_status_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_readings" ADD CONSTRAINT "mileage_readings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_readings" ADD CONSTRAINT "mileage_readings_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express. These live in the database, not only in forms: a form is
-- one of several ways a row gets written, and the others (a script, a future API, a
-- hand-run fix) do not read the form's validation.
-- ---------------------------------------------------------------------------

-- A B2B vehicle is leased in from a supplier, so a B2B vehicle with no supplier has no
-- one to pay and no cost to profit against (P1B-04 — "DB constraint, not just UI").
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_b2b_requires_supplier"
  CHECK ("ownership_type" <> 'B2B_SUPPLIER' OR "supplier_id" IS NOT NULL);

ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_mileage_non_negative"
  CHECK ("current_mileage_km" >= 0);

-- Catches the four-digit typo (2206, 1025) before it becomes a vehicle's model year.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_year_plausible"
  CHECK ("year" BETWEEN 1980 AND 2100);

ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_money_non_negative"
  CHECK (("purchase_price_fils" IS NULL OR "purchase_price_fils" >= 0)
     AND ("supplier_monthly_cost_fils" IS NULL OR "supplier_monthly_cost_fils" >= 0));

ALTER TABLE "mileage_readings" ADD CONSTRAINT "mileage_readings_non_negative"
  CHECK ("reading_km" >= 0);

-- Fleet numbers, VEH-00001, allocated like customer and supplier codes: a sequence never
-- hands two concurrent creates the same number.
CREATE SEQUENCE IF NOT EXISTS vehicle_code_seq AS BIGINT START WITH 1 INCREMENT BY 1;

-- Global search (§16) names plate and VIN explicitly.
CREATE INDEX IF NOT EXISTS vehicles_plate_number_trgm ON vehicles USING gin (plate_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicles_vin_trgm ON vehicles USING gin (vin gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicles_code_trgm ON vehicles USING gin (code gin_trgm_ops);
