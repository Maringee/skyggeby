-- CreateEnum
CREATE TYPE "InformationType" AS ENUM ('RYKTE', 'OBSERVASJON', 'ETTERRETNING', 'KONTAKT', 'HEMMELIGHET');

-- CreateEnum
CREATE TYPE "InformationSource" AS ENUM ('UKJENT', 'OBSERVASJON', 'KONTAKT', 'ETTERFORSKNING', 'HENDELSE');

-- CreateEnum
CREATE TYPE "InformationRelevance" AS ENUM ('POLITI', 'AKTIVITET', 'SIKKERHET', 'LAGER', 'TRANSPORT', 'MULIGHET');

-- AlterTable
ALTER TABLE "crime_attempts" ADD COLUMN     "informationBonus" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "informationId" TEXT;

-- AlterTable
ALTER TABLE "players" ADD COLUMN     "lastExploredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "information" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" "InformationType" NOT NULL,
    "source" "InformationSource" NOT NULL,
    "relevance" "InformationRelevance" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "districtId" TEXT,
    "reliability" INTEGER NOT NULL,
    "isTrue" BOOLEAN NOT NULL,
    "baseValue" INTEGER NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedOnCrimeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "information_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "information_ownerId_usedAt_idx" ON "information"("ownerId", "usedAt");

-- CreateIndex
CREATE INDEX "information_ownerId_districtId_usedAt_idx" ON "information"("ownerId", "districtId", "usedAt");

-- CreateIndex
CREATE INDEX "information_ownerId_discoveredAt_idx" ON "information"("ownerId", "discoveredAt");

-- CreateIndex
CREATE INDEX "information_districtId_idx" ON "information"("districtId");

-- AddForeignKey
ALTER TABLE "information" ADD CONSTRAINT "information_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reliability and worth are server-decided values, but the database refuses an
-- out-of-range one regardless of which code path writes it.
ALTER TABLE "information"
  ADD CONSTRAINT "information_reliability_range"
  CHECK ("reliability" >= 0 AND "reliability" <= 100);

ALTER TABLE "information"
  ADD CONSTRAINT "information_base_value_non_negative"
  CHECK ("baseValue" >= 0);
