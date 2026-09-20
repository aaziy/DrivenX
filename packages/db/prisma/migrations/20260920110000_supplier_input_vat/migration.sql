-- Input VAT on supplier invoices is recoverable (client, 2026-09-20), so what the
-- supplier bills splits three ways: the net amount, which is the cost; the VAT, which is
-- reclaimed and is never cost; and the gross, which is what DrivenX pays them.
ALTER TABLE "supplier_invoices" DROP CONSTRAINT IF EXISTS "supplier_invoices_amount_positive";
ALTER TABLE "supplier_invoices" DROP CONSTRAINT IF EXISTS "supplier_invoices_paid_within_amount";

ALTER TABLE "supplier_invoices" RENAME COLUMN "amount_fils" TO "net_fils";
ALTER TABLE "supplier_invoices" ADD COLUMN "vat_basis_points" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "supplier_invoices" ADD COLUMN "vat_fils" BIGINT;
ALTER TABLE "supplier_invoices" ADD COLUMN "gross_fils" BIGINT;

-- Existing rows were entered as the agreed net monthly cost, so VAT goes on top of them,
-- rounded half up to the fil exactly as the customer side rounds it.
UPDATE "supplier_invoices"
   SET "vat_fils" = (("net_fils" * "vat_basis_points") + 5000) / 10000
 WHERE "vat_fils" IS NULL;
UPDATE "supplier_invoices" SET "gross_fils" = "net_fils" + "vat_fils" WHERE "gross_fils" IS NULL;

ALTER TABLE "supplier_invoices" ALTER COLUMN "vat_fils" SET NOT NULL;
ALTER TABLE "supplier_invoices" ALTER COLUMN "gross_fils" SET NOT NULL;

ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_amount_positive"
  CHECK ("net_fils" > 0 AND "vat_fils" >= 0);

ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_gross_is_net_plus_vat"
  CHECK ("gross_fils" = "net_fils" + "vat_fils");

ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_paid_within_amount"
  CHECK ("paid_fils" >= 0 AND "paid_fils" <= "gross_fils");
