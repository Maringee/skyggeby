-- AlterTable
ALTER TABLE "crime_attempts" ADD COLUMN     "districtId" TEXT NOT NULL DEFAULT 'sentrum';

-- AlterTable
ALTER TABLE "players" ADD COLUMN     "currentDistrictId" TEXT NOT NULL DEFAULT 'sentrum';
