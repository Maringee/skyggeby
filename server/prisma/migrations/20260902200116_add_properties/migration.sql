-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'EIENDOM_KJOP';
ALTER TYPE "TransactionType" ADD VALUE 'EIENDOM_SALG';

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "propertyTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purchasePrice" INTEGER NOT NULL,
    "currentValue" INTEGER NOT NULL,
    "condition" INTEGER NOT NULL DEFAULT 100,
    "storageCapacity" INTEGER NOT NULL,
    "security" INTEGER NOT NULL,
    "districtId" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "properties_playerId_idx" ON "properties"("playerId");

-- CreateIndex
CREATE INDEX "properties_playerId_districtId_idx" ON "properties"("playerId", "districtId");

-- CreateIndex
CREATE INDEX "properties_districtId_idx" ON "properties"("districtId");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The server decides every one of these, but the database refuses an
-- out-of-range value regardless of which code path writes it.
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_prices_not_negative"
  CHECK ("purchasePrice" >= 0 AND "currentValue" >= 0);

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_condition_range"
  CHECK ("condition" >= 0 AND "condition" <= 100);

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_storage_not_negative"
  CHECK ("storageCapacity" >= 0);

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_security_range"
  CHECK ("security" >= 1 AND "security" <= 5);

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_name_length"
  CHECK (char_length(btrim("name")) BETWEEN 3 AND 32);
