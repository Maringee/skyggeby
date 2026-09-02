-- AlterTable
ALTER TABLE "players" ADD COLUMN     "skillPoints" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "player_skills" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_skills_playerId_idx" ON "player_skills"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "player_skills_playerId_skillId_key" ON "player_skills"("playerId", "skillId");

-- AddForeignKey
ALTER TABLE "player_skills" ADD CONSTRAINT "player_skills_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Skill points and skill levels are server-decided, but the database refuses an
-- impossible value regardless of which code path writes it. The CHECK on
-- skillPoints is what makes a lost concurrency race fail loudly rather than
-- quietly leaving a player with a negative balance.
ALTER TABLE "players"
  ADD CONSTRAINT "players_skill_points_non_negative"
  CHECK ("skillPoints" >= 0);

ALTER TABLE "player_skills"
  ADD CONSTRAINT "player_skills_level_range"
  CHECK ("level" >= 0 AND "level" <= 25);

-- Every existing account gets all six skills at level 0.
INSERT INTO "player_skills" ("id", "playerId", "skillId", "level", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."id", s."skillId", 0, now(), now()
FROM "players" p
CROSS JOIN (
  VALUES ('etterretning'), ('kriminalitet'), ('forretning'),
         ('mobilitet'), ('sosial'), ('motstandskraft')
) AS s("skillId");

-- Baseline for accounts that existed before skills: exactly the points they
-- would have earned had the system always been there, given their level.
--   level 1        -> 0
--   levels 2-10    -> +2 each
--   levels 11-20   -> +1 each
--   levels 21+     -> no further points in v1
UPDATE "players" SET "skillPoints" = CASE
  WHEN "level" <= 1  THEN 0
  WHEN "level" <= 10 THEN 2 * ("level" - 1)
  WHEN "level" <= 20 THEN 18 + ("level" - 10)
  ELSE 28
END;
