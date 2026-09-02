-- CreateEnum
CREATE TYPE "AssetStorage" AS ENUM ('INVENTORY', 'STORED');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "storageLocation" "AssetStorage" NOT NULL DEFAULT 'STORED';

-- CreateIndex
CREATE INDEX "assets_playerId_storageLocation_idx" ON "assets"("playerId", "storageLocation");
