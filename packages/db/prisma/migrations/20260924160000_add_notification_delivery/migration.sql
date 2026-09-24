-- CreateEnum
CREATE TYPE "delivery_channel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_notifications" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "channel" "delivery_channel" NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'PENDING',
    "user_id" TEXT,
    "recipient" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_deliveries_status_channel_idx" ON "notification_deliveries"("status", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_recipient_key" ON "notification_deliveries"("notification_id", "channel", "recipient");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A delivery that says it was sent carries the moment it was sent. Without this, a
-- delivery could report success with nothing to say when, and the log stops being
-- evidence that anybody was actually told.
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "deliveries_sent_has_a_time"
  CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL));

-- There is always somewhere it was sent to, even when the answer is "nowhere": a skipped
-- delivery records the address it would have used, or why there was none.
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "deliveries_have_a_recipient"
  CHECK (length("recipient") > 0);
