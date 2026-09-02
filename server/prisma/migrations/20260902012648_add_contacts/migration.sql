-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('AVAILABLE', 'BUSY', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "contact_relationships" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "trust" INTEGER NOT NULL DEFAULT 10,
    "status" "ContactStatus" NOT NULL DEFAULT 'AVAILABLE',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInteractionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_relationships_playerId_idx" ON "contact_relationships"("playerId");

-- CreateIndex
CREATE INDEX "contact_relationships_playerId_status_idx" ON "contact_relationships"("playerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contact_relationships_playerId_contactId_key" ON "contact_relationships"("playerId", "contactId");

-- AddForeignKey
ALTER TABLE "contact_relationships" ADD CONSTRAINT "contact_relationships_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trust is server-decided, but the database refuses an out-of-range value
-- regardless of which code path writes it.
ALTER TABLE "contact_relationships"
  ADD CONSTRAINT "contact_relationships_trust_range"
  CHECK ("trust" >= 0 AND "trust" <= 100);
