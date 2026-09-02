-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'VIRKSOMHET_KJOP';
ALTER TYPE "TransactionType" ADD VALUE 'VIRKSOMHET_UTTAK';

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "businessTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "cashBalance" INTEGER NOT NULL DEFAULT 0,
    "condition" INTEGER NOT NULL DEFAULT 100,
    "activity" INTEGER NOT NULL,
    "risk" INTEGER NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSettlementAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "businesses_playerId_idx" ON "businesses"("playerId");

-- CreateIndex
CREATE INDEX "businesses_playerId_districtId_idx" ON "businesses"("playerId", "districtId");

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The server decides every one of these, but the database refuses an
-- out-of-range value regardless of which code path writes it. A business
-- account can never go negative, no matter what a future withdrawal does.
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_cash_balance_not_negative"
  CHECK ("cashBalance" >= 0);

ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_condition_range"
  CHECK ("condition" >= 0 AND "condition" <= 100);

ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_activity_range"
  CHECK ("activity" >= 0 AND "activity" <= 100);

ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_risk_range"
  CHECK ("risk" >= 1 AND "risk" <= 5);
