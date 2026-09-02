-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "vehicleTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationDistrictId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_assetId_key" ON "vehicles"("assetId");

-- CreateIndex
CREATE INDEX "vehicles_playerId_idx" ON "vehicles"("playerId");

-- CreateIndex
CREATE INDEX "vehicles_playerId_isActive_idx" ON "vehicles"("playerId", "isActive");

-- CreateIndex
CREATE INDEX "vehicles_locationDistrictId_idx" ON "vehicles"("locationDistrictId");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The name is trimmed and length-checked by the server, but the database
-- refuses an empty or absurd one no matter which code path writes it.
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_name_length"
  CHECK (char_length(btrim("name")) BETWEEN 3 AND 32);

-- At most one active vehicle per player, guaranteed by the database rather
-- than only by the transaction that swaps them. A partial index, so any number
-- of parked vehicles is still fine.
CREATE UNIQUE INDEX "vehicles_one_active_per_player"
  ON "vehicles" ("playerId")
  WHERE "isActive";

-- Backfill: every vehicle a player already owns as an asset becomes a
-- registered vehicle, parked where the asset already was. Ownership, price,
-- value and condition stay on the asset and are not touched.
INSERT INTO "vehicles" ("id", "playerId", "assetId", "vehicleTypeId", "name", "locationDistrictId", "isActive", "createdAt", "updatedAt")
SELECT
  'veh_' || "a"."id",
  "a"."playerId",
  "a"."id",
  "a"."assetTypeId",
  "a"."name",
  "a"."location",
  false,
  "a"."purchasedAt",
  CURRENT_TIMESTAMP
FROM "assets" AS "a"
WHERE "a"."category" = 'VEHICLE'
  AND char_length(btrim("a"."name")) BETWEEN 3 AND 32;
