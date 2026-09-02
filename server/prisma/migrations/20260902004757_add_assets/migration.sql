-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('VEHICLE', 'EQUIPMENT', 'TECHNOLOGY', 'VALUABLE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'STORED', 'DAMAGED', 'SEIZED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'EIENDEL_KJOP';
ALTER TYPE "TransactionType" ADD VALUE 'EIENDEL_SALG';

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "assetTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "purchasePrice" INTEGER NOT NULL,
    "currentValue" INTEGER NOT NULL,
    "condition" INTEGER NOT NULL DEFAULT 100,
    "maintenanceCostPerDay" INTEGER NOT NULL,
    "maintenancePaidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visibility" INTEGER NOT NULL,
    "risk" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_playerId_idx" ON "assets"("playerId");

-- CreateIndex
CREATE INDEX "assets_playerId_status_idx" ON "assets"("playerId", "status");

-- CreateIndex
CREATE INDEX "assets_playerId_category_idx" ON "assets"("playerId", "category");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Condition and money are server-decided, but the database refuses an
-- impossible value regardless of which code path writes it.
ALTER TABLE "assets"
  ADD CONSTRAINT "assets_condition_range"
  CHECK ("condition" >= 0 AND "condition" <= 100);

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_prices_non_negative"
  CHECK ("purchasePrice" >= 0 AND "currentValue" >= 0 AND "maintenanceCostPerDay" >= 0);
