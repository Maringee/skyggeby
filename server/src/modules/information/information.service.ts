import type { Information, Player } from '@prisma/client';
import {
  INFORMATION_TUNING,
  formatDuration,
  resolveDistrict,
  type InformationRelevance,
  type InformationSource,
  type InformationType,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, notFound } from '../../lib/errors';
import { randomChance } from '../../lib/random';
import { lockPlayer } from '../economy/transaction.service';
import { advanceMissionProgressTx } from '../missions/mission.progress';
import { grantXp, maxEnergyAfter, settleVitalsTx } from '../player/progression.service';
import { getSkillEffects } from '../skills/skill.effects';
import { getSkillLevelsTx } from '../skills/skill.service';
import { discoveryChance, generateDiscovery } from './information.generator';
import type { ExploreResult } from './information.types';

/**
 * Exploring the district the player is actually standing in.
 *
 * Follows the same shape as a crime: lock the row, settle passive state,
 * validate, charge, write, commit. Everything the operation depends on is read
 * from the database inside the transaction, so nothing the client sends can
 * influence where it happens, what it costs or what it finds.
 */
export async function exploreCurrentDistrict(playerId: string): Promise<ExploreResult> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();

    await lockPlayer(tx, playerId);

    const loaded = await tx.player.findUnique({ where: { id: playerId } });
    if (!loaded) throw notFound('Fant ikke spilleren.');

    const settled = await settleVitalsTx(tx, loaded, now);
    const player = settled.player;

    // Cooldown, from the player's own row rather than anything sent to us.
    if (player.lastExploredAt) {
      const readyAt =
        player.lastExploredAt.getTime() + INFORMATION_TUNING.exploreCooldownSeconds * 1000;
      if (readyAt > now.getTime()) {
        const remaining = Math.ceil((readyAt - now.getTime()) / 1000);
        throw new AppError(
          429,
          'AVKJOLING_AKTIV',
          `Du må vente ${formatDuration(remaining)} før du kan lete igjen.`,
        );
      }
    }

    if (player.energy < INFORMATION_TUNING.exploreEnergyCost) {
      throw new AppError(
        400,
        'FOR_LITE_ENERGI',
        `Du har ikke nok energi. Å lete koster ${INFORMATION_TUNING.exploreEnergyCost}, du har ${player.energy}.`,
      );
    }

    // The district comes from the locked row, never from the request.
    const district = resolveDistrict(player.currentDistrictId);

    // Skills read inside the transaction, turned into numbers by the one
    // function allowed to do that.
    const skillEffects = getSkillEffects(await getSkillLevelsTx(tx, playerId));

    const cooldownUntil = new Date(
      now.getTime() + INFORMATION_TUNING.exploreCooldownSeconds * 1000,
    );

    // Looking around is work, so it pays experience whether or not the round
    // turns anything up. Early game needs routes forward that are not crime.
    const progression = grantXp(player.xp, player.level, INFORMATION_TUNING.exploreXp);

    await tx.player.update({
      where: { id: playerId },
      data: {
        energy: Math.max(0, player.energy - INFORMATION_TUNING.exploreEnergyCost),
        // Spending energy restarts the regeneration clock from a known point.
        energyUpdatedAt: player.energy >= player.maxEnergy ? now : player.energyUpdatedAt,
        lastExploredAt: now,
        xp: progression.xp,
        level: progression.level,
        // Granted by the same write as the level, so the two cannot drift.
        skillPoints: { increment: progression.skillPointsGained },
        maxEnergy: maxEnergyAfter(player.maxEnergy, progression.level),
      },
    });

    const found =
      randomChance() <
      discoveryChance(district, skillEffects.informationDiscoveryChance);

    // A round that turns up nothing is still a round walked, so it counts
    // towards a mission that asked for the walking. What was found - if
    // anything - decides whether a mission that asked for a *kind* of
    // knowledge is satisfied.
    if (!found) {
      await advanceMissionProgressTx(
        tx,
        playerId,
        { kind: 'UTFORSK', districtId: district.id, relevance: null },
        now,
      );

      return {
        found: null,
        message: `Du gikk runden i ${district.name}, men kom tilbake med ingenting.`,
        energySpent: INFORMATION_TUNING.exploreEnergyCost,
        xpGained: INFORMATION_TUNING.exploreXp,
        leveledUp: progression.leveledUp,
        newLevel: progression.level,
        skillPointsGained: progression.skillPointsGained,
        cooldownUntil,
      } satisfies ExploreResult;
    }

    const draft = generateDiscovery(district, skillEffects.informationReliability);

    const information = await tx.information.create({
      data: {
        ownerId: playerId,
        type: draft.type as InformationType,
        source: draft.source as InformationSource,
        relevance: draft.relevance as InformationRelevance,
        title: draft.title,
        content: draft.content,
        districtId: draft.districtId,
        reliability: draft.reliability,
        isTrue: draft.isTrue,
        baseValue: draft.baseValue,
        discoveredAt: now,
        expiresAt: draft.expiresAt,
      },
    });

    await advanceMissionProgressTx(
      tx,
      playerId,
      {
        kind: 'UTFORSK',
        districtId: district.id,
        relevance: information.relevance as InformationRelevance,
      },
      now,
    );

    return {
      found: information,
      message: `Du fant noe i ${district.name}.`,
      energySpent: INFORMATION_TUNING.exploreEnergyCost,
      xpGained: INFORMATION_TUNING.exploreXp,
      leveledUp: progression.leveledUp,
      newLevel: progression.level,
      skillPointsGained: progression.skillPointsGained,
      cooldownUntil,
    } satisfies ExploreResult;
  });
}

/** Everything the player currently holds, newest first. */
export async function listInformation(playerId: string): Promise<Information[]> {
  return prisma.information.findMany({
    where: { ownerId: playerId },
    orderBy: [{ usedAt: 'asc' }, { discoveredAt: 'desc' }],
    take: 200,
  });
}

/** One piece, scoped to its owner so an id alone grants nothing. */
export async function getInformation(
  playerId: string,
  informationId: string,
): Promise<Information> {
  const row = await prisma.information.findFirst({
    where: { id: informationId, ownerId: playerId },
  });

  if (!row) throw notFound('Fant ikke denne informasjonen.');
  return row;
}

/** Seconds until the player may explore again, 0 when ready. */
export function exploreCooldownRemaining(player: Player, now: Date = new Date()): number {
  if (!player.lastExploredAt) return 0;

  const readyAt =
    player.lastExploredAt.getTime() + INFORMATION_TUNING.exploreCooldownSeconds * 1000;

  return Math.max(0, Math.ceil((readyAt - now.getTime()) / 1000));
}
