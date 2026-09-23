-- CreateEnum
CREATE TYPE "handover_type" AS ENUM ('HANDOVER', 'RETURN');

-- CreateEnum
CREATE TYPE "handover_status" AS ENUM ('DRAFT', 'SIGNED');

-- CreateEnum
CREATE TYPE "vehicle_panel" AS ENUM ('FRONT_BUMPER', 'BONNET', 'WINDSCREEN', 'ROOF', 'REAR_SCREEN', 'BOOT', 'REAR_BUMPER', 'FRONT_LEFT_WING', 'FRONT_LEFT_DOOR', 'REAR_LEFT_DOOR', 'REAR_LEFT_WING', 'FRONT_RIGHT_WING', 'FRONT_RIGHT_DOOR', 'REAR_RIGHT_DOOR', 'REAR_RIGHT_WING', 'WHEELS', 'INTERIOR', 'MECHANICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "damage_severity" AS ENUM ('MINOR', 'MODERATE', 'SEVERE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "document_owner_type" ADD VALUE IF NOT EXISTS 'HANDOVER';
ALTER TYPE "document_owner_type" ADD VALUE IF NOT EXISTS 'DAMAGE_POINT';

-- CreateTable
CREATE TABLE "handovers" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "type" "handover_type" NOT NULL,
    "status" "handover_status" NOT NULL DEFAULT 'DRAFT',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "odometer_km" INTEGER NOT NULL,
    "fuel_eighths" INTEGER NOT NULL,
    "condition_notes" TEXT,
    "customer_signature_key" TEXT,
    "customer_signature_name" TEXT,
    "customer_signed_at" TIMESTAMP(3),
    "staff_signature_key" TEXT,
    "staff_signature_name" TEXT,
    "staff_signed_at" TIMESTAMP(3),
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_points" (
    "id" TEXT NOT NULL,
    "handover_id" TEXT NOT NULL,
    "panel" "vehicle_panel" NOT NULL,
    "severity" "damage_severity" NOT NULL DEFAULT 'MINOR',
    "position_x" DOUBLE PRECISION,
    "position_y" DOUBLE PRECISION,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handovers_vehicle_id_occurred_at_idx" ON "handovers"("vehicle_id", "occurred_at");

-- CreateIndex
CREATE INDEX "handovers_status_idx" ON "handovers"("status");

-- CreateIndex
CREATE INDEX "handovers_contract_id_type_idx" ON "handovers"("contract_id", "type");

-- One handover and one return per contract, counting only the forms that still stand. A
-- plain unique index would let a draft that was thrown away hold the slot for ever, and
-- the car did go out: someone has to be able to record it again.
CREATE UNIQUE INDEX "handovers_one_per_contract_and_type"
  ON "handovers" ("contract_id", "type")
  WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "damage_points_handover_id_idx" ON "damage_points"("handover_id");

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_points" ADD CONSTRAINT "damage_points_handover_id_fkey" FOREIGN KEY ("handover_id") REFERENCES "handovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_points" ADD CONSTRAINT "damage_points_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A gauge reads between empty and full, in eighths (core/fleet/handover.ts). A reading
-- outside that range is a typo, and it is the figure a refuelling argument turns on.
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_fuel_within_tank"
  CHECK ("fuel_eighths" BETWEEN 0 AND 8);

ALTER TABLE "handovers" ADD CONSTRAINT "handovers_odometer_non_negative"
  CHECK ("odometer_km" >= 0);

-- A signature is a file plus the name of whoever made it plus when: two out of three is a
-- mark nobody can be held to, so the three columns stand or fall together.
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_customer_signature_complete"
  CHECK (num_nonnulls("customer_signature_key", "customer_signature_name", "customer_signed_at") IN (0, 3));

ALTER TABLE "handovers" ADD CONSTRAINT "handovers_staff_signature_complete"
  CHECK (num_nonnulls("staff_signature_key", "staff_signature_name", "staff_signed_at") IN (0, 3));

-- A signed form is evidence, and evidence carries both signatures. The application
-- refuses to sign one without the other; this is what stops any other path doing it.
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_signed_has_both_signatures"
  CHECK ("status" <> 'SIGNED'
     OR ("customer_signature_key" IS NOT NULL AND "staff_signature_key" IS NOT NULL));

-- A mark is either on the diagram with both coordinates, or off it with neither. One
-- coordinate alone would draw at the edge of the picture and claim damage nobody marked.
ALTER TABLE "damage_points" ADD CONSTRAINT "damage_points_position_complete"
  CHECK (num_nonnulls("position_x", "position_y") IN (0, 2));

ALTER TABLE "damage_points" ADD CONSTRAINT "damage_points_position_within_diagram"
  CHECK (("position_x" IS NULL OR "position_x" BETWEEN 0 AND 1)
     AND ("position_y" IS NULL OR "position_y" BETWEEN 0 AND 1));
