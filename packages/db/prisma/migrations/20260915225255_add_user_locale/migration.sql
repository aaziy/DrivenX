-- CreateEnum
CREATE TYPE "locale" AS ENUM ('en', 'ar');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" "locale" NOT NULL DEFAULT 'en';
