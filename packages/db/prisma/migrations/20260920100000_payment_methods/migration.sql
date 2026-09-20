-- Payment methods the client actually uses (2026-09-20): bank transfer, cash, card,
-- Tamara and Tabby. Cheques are not used, so the value goes; anything recorded as one
-- becomes Other rather than being lost.
UPDATE "payments" SET "method" = 'OTHER' WHERE "method" = 'CHEQUE';
UPDATE "supplier_payments" SET "method" = 'OTHER' WHERE "method" = 'CHEQUE';

CREATE TYPE "payment_method_new" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'TAMARA', 'TABBY', 'OTHER');

ALTER TABLE "payments" ALTER COLUMN "method" TYPE "payment_method_new"
  USING "method"::text::"payment_method_new";
ALTER TABLE "supplier_payments" ALTER COLUMN "method" TYPE "payment_method_new"
  USING "method"::text::"payment_method_new";

DROP TYPE "payment_method";
ALTER TYPE "payment_method_new" RENAME TO "payment_method";
