import type { Player, Prisma } from '@prisma/client';
import {
  LIMITS,
  levelFromXp,
  raisedMaxEnergy,
  regenerateVitals,
  skillPointsForLevelUp,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { notFound } from '../../lib/errors';
import { lockPlayer } from '../economy/transaction.service';

export interface SettledVitals {
  energy: number;
  heat: number;
  energyUpdatedAt: Date;
  heatUpdatedAt: Date;
  changed: boolean;
}

/** Computes - but does not persist - the passive vitals a player has earned. */
export function settleVitals(player: Player, now: Date = new Date()): SettledVitals {
  const result = regenerateVitals(
    {
      energy: player.energy,
      heat: player.heat,
      energyUpdatedAt: player.energyUpdatedAt,
      heatUpdatedAt: player.heatUpdatedAt,
      maxEnergy: player.maxEnergy,
    },
    now,
  );

  return {
    energy: result.energy,
    heat: result.heat,
    energyUpdatedAt: result.energyUpdatedAt,
    heatUpdatedAt: result.heatUpdatedAt,
    changed:
      result.energy !== player.energy ||
      result.heat !== player.heat ||
      result.energyUpdatedAt.getTime() !== player.energyUpdatedAt.getTime() ||
      result.heatUpdatedAt.getTime() !== player.heatUpdatedAt.getTime(),
  };
}

/**
 * Settles passive energy/heat inside an already open transaction and returns
 * the player as it now stands. Callers that only read may use
 * {@link syncVitals} instead.
 */
export async function settleVitalsTx(
  tx: Prisma.TransactionClient,
  player: Player,
  now: Date = new Date(),
): Promise<{ player: Player; vitals: SettledVitals }> {
  const vitals = settleVitals(player, now);
  if (!vitals.changed) return { player, vitals };

  const updated = await tx.player.update({
    where: { id: player.id },
    data: {
      energy: vitals.energy,
      heat: vitals.heat,
      energyUpdatedAt: vitals.energyUpdatedAt,
      heatUpdatedAt: vitals.heatUpdatedAt,
    },
  });

  return { player: updated, vitals };
}

/**
 * Reads a player and brings their passive vitals up to date. Used by every
 * read-only endpoint so the client never sees a stale energy bar.
 */
export async function syncVitals(playerId: string): Promise<Player> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) throw notFound('Fant ikke spilleren.');

  const vitals = settleVitals(player);
  if (!vitals.changed) return player;

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    const fresh = await tx.player.findUniqueOrThrow({ where: { id: playerId } });
    const settled = await settleVitalsTx(tx, fresh);
    return settled.player;
  });
}

export interface XpGrant {
  xp: number;
  level: number;
  leveledUp: boolean;
  levelsGained: number;
  /**
   * Skill points earned by this grant. Awarded by the same update that writes
   * the new level, so the two can never drift apart or be applied twice.
   */
  skillPointsGained: number;
}

/**
 * The energy cap that goes with a level.
 *
 * Written by the same update as the level itself, for the same reason skill
 * points are: two writes could drift, one cannot. It never lowers an existing
 * cap, so the change costs nobody anything they already had.
 */
export function maxEnergyAfter(currentMax: number, level: number): number {
  return raisedMaxEnergy(currentMax, level);
}

/**
 * Pure XP math. The level always follows from total XP, so a player can never
 * end up at a level their XP does not justify.
 */
export function grantXp(currentXp: number, currentLevel: number, gained: number): XpGrant {
  // Clamped at both ends: never negative, never past the Int32 column ceiling.
  const xp = Math.min(
    LIMITS.maxXp,
    Math.max(0, currentXp + Math.max(0, Math.trunc(gained))),
  );
  const level = levelFromXp(xp);

  return {
    xp,
    level,
    leveledUp: level > currentLevel,
    levelsGained: Math.max(0, level - currentLevel),
    skillPointsGained: skillPointsForLevelUp(currentLevel, level),
  };
}
