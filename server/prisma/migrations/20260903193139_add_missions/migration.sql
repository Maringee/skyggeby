-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'OPPDRAG';

-- CreateTable
CREATE TABLE "missions" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AKTIV',
    "progressCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "missions_playerId_status_idx" ON "missions"("playerId", "status");

-- CreateIndex
CREATE INDEX "missions_playerId_missionId_idx" ON "missions"("playerId", "missionId");

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------
-- Lagt til manuelt. Databasen er siste skanse: selv om tjenesten alltid
-- validerer, skal ingen ugyldig rad kunne finnes om koden en dag tar feil.
-- ------------------------------------------------------------------

-- Status kan bare være de fire lovlige verdiene.
ALTER TABLE "missions" ADD CONSTRAINT "missions_status_check"
  CHECK ("status" IN ('AKTIV', 'FULLFORT', 'AVBRUTT', 'UTLOPT'));

-- Framdrift kan aldri bli negativ.
ALTER TABLE "missions" ADD CONSTRAINT "missions_progress_check"
  CHECK ("progressCount" >= 0);

-- Et fullført oppdrag må ha et tidspunkt, og et uferdig må ikke ha ett.
ALTER TABLE "missions" ADD CONSTRAINT "missions_completed_check"
  CHECK (
    ("status" = 'FULLFORT' AND "completedAt" IS NOT NULL)
    OR ("status" <> 'FULLFORT' AND "completedAt" IS NULL)
  );

-- Aldri to aktive kopier av samme oppdrag for samme spiller. Dette er den
-- egentlige garantien bak "maks 3 aktive": tjenesten teller under radlås, og
-- indeksen fanger opp alt som likevel skulle slippe gjennom. Fullførte og
-- avbrutte rader er historikk og dekkes ikke.
CREATE UNIQUE INDEX "missions_one_active"
  ON "missions" ("playerId", "missionId") WHERE "status" = 'AKTIV';
