-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'DEAL_CREATED', 'CONTRACTED', 'LOST');

-- CreateEnum
CREATE TYPE "lead_source" AS ENUM ('WALK_IN', 'PHONE', 'WHATSAPP', 'WEBSITE', 'SOCIAL', 'REFERRAL', 'OTHER');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "lead_id" TEXT,
ADD COLUMN     "salesperson_id" TEXT;

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "lead_status" NOT NULL DEFAULT 'NEW',
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "source" "lead_source" NOT NULL DEFAULT 'OTHER',
    "interested_vehicle_id" TEXT,
    "budget_fils" BIGINT,
    "duration_months" INTEGER,
    "notes" TEXT,
    "salesperson_id" TEXT,
    "lost_reason" TEXT,
    "customer_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_quotes" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "type" "contract_type" NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "monthly_rental_fils" BIGINT NOT NULL,
    "down_payment_fils" BIGINT NOT NULL DEFAULT 0,
    "annual_insurance_fils" BIGINT NOT NULL DEFAULT 0,
    "buyout_fils" BIGINT NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_status_changes" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "from_status" "lead_status",
    "to_status" "lead_status" NOT NULL,
    "note" TEXT,
    "changed_by_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_code_key" ON "leads"("code");

-- CreateIndex
CREATE INDEX "leads_salesperson_id_status_idx" ON "leads"("salesperson_id", "status");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_mobile_idx" ON "leads"("mobile");

-- CreateIndex
CREATE INDEX "lead_quotes_lead_id_created_at_idx" ON "lead_quotes"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_status_changes_lead_id_changed_at_idx" ON "lead_status_changes"("lead_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_lead_id_key" ON "contracts"("lead_id");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_interested_vehicle_id_fkey" FOREIGN KEY ("interested_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_quotes" ADD CONSTRAINT "lead_quotes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_quotes" ADD CONSTRAINT "lead_quotes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_quotes" ADD CONSTRAINT "lead_quotes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_changes" ADD CONSTRAINT "lead_status_changes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_changes" ADD CONSTRAINT "lead_status_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- LEAD-00001, gapless enough for a display code; a skipped number costs nothing here.
CREATE SEQUENCE IF NOT EXISTS lead_code_seq AS BIGINT START WITH 1 INCREMENT BY 1;

-- A lost lead says why; the funnel report groups on it.
ALTER TABLE "leads" ADD CONSTRAINT "leads_lost_needs_reason"
  CHECK ("status" <> 'LOST' OR ("lost_reason" IS NOT NULL AND length(trim("lost_reason")) > 0));

ALTER TABLE "leads" ADD CONSTRAINT "leads_budget_non_negative"
  CHECK ("budget_fils" IS NULL OR "budget_fils" >= 0);

ALTER TABLE "leads" ADD CONSTRAINT "leads_duration_in_range"
  CHECK ("duration_months" IS NULL OR "duration_months" BETWEEN 1 AND 120);

ALTER TABLE "lead_quotes" ADD CONSTRAINT "lead_quotes_amounts_valid"
  CHECK ("monthly_rental_fils" > 0 AND "down_payment_fils" >= 0 AND "annual_insurance_fils" >= 0
         AND "buyout_fils" >= 0 AND "duration_months" BETWEEN 1 AND 120);
