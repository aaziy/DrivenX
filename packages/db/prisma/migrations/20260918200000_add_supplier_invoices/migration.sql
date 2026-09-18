-- CreateEnum
CREATE TYPE "supplier_invoice_status" AS ENUM ('UPCOMING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "amount_fils" BIGINT NOT NULL,
    "paid_fils" BIGINT NOT NULL DEFAULT 0,
    "status" "supplier_invoice_status" NOT NULL DEFAULT 'UPCOMING',
    "raised_on" DATE,
    "supplier_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "supplier_invoice_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "paid_on" DATE NOT NULL,
    "amount_fils" BIGINT NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_invoices_supplier_id_due_date_idx" ON "supplier_invoices"("supplier_id", "due_date");

-- CreateIndex
CREATE INDEX "supplier_invoices_due_date_status_idx" ON "supplier_invoices"("due_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_contract_id_sequence_key" ON "supplier_invoices"("contract_id", "sequence");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_invoice_id_idx" ON "supplier_payments"("supplier_invoice_id");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_id_paid_on_idx" ON "supplier_payments"("supplier_id", "paid_on");

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_invoice_id_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What is owed is above zero and never overpaid; the service refuses both, and these make
-- sure nothing else can write them either.
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_amount_positive"
  CHECK ("amount_fils" > 0);

ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_paid_within_amount"
  CHECK ("paid_fils" >= 0 AND "paid_fils" <= "amount_fils");

ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_period_order"
  CHECK ("period_start" <= "period_end");

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_positive"
  CHECK ("amount_fils" > 0);
