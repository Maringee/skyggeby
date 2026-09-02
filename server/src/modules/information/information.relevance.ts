import type { Information, Prisma } from '@prisma/client';
import {
  informationBonusPoints,
  relevanceForCrime,
  type InformationRelevance,
  type InformationType,
} from '@skyggeby/shared';
import { freshnessOf } from './information.freshness';
import type { AppliedInformation } from './information.types';

/**
 * Deciding which knowledge helps which job.
 *
 * The mapping itself lives in the shared catalogue so the UI can explain it;
 * this module owns the database side of picking the right row and consuming it.
 */

/**
 * Finds the single most useful unused piece of information the player holds for
 * this job in this district, or null.
 *
 * Only information that is relevant to the crime and either tied to the current
 * district or city-wide can qualify. Ranking happens in memory because the
 * bonus depends on freshness, which is derived from timestamps rather than
 * stored.
 */
export async function findBestInformation(
  tx: Prisma.TransactionClient,
  playerId: string,
  crimeId: string,
  districtId: string,
  now: Date,
): Promise<{ information: Information; bonusPoints: number } | null> {
  const relevance = relevanceForCrime(crimeId) as InformationRelevance[];
  if (relevance.length === 0) return null;

  const candidates = await tx.information.findMany({
    where: {
      ownerId: playerId,
      usedAt: null,
      relevance: { in: relevance },
      // City-wide information applies anywhere; the rest only where it is about.
      OR: [{ districtId }, { districtId: null }],
    },
    orderBy: { discoveredAt: 'desc' },
    take: 25,
  });

  let best: { information: Information; bonusPoints: number } | null = null;

  for (const candidate of candidates) {
    const bonusPoints = informationBonusPoints({
      type: candidate.type as InformationType,
      reliability: candidate.reliability,
      freshness: freshnessOf(candidate, now),
    });

    if (bonusPoints <= 0) continue;
    if (!best || bonusPoints > best.bonusPoints) {
      best = { information: candidate, bonusPoints };
    }
  }

  return best;
}

/**
 * Marks information as consumed, and reports whether this caller was the one
 * that consumed it.
 *
 * The `usedAt: null` guard makes the update itself the claim: two crimes racing
 * for the same tip cannot both win it, regardless of locking elsewhere.
 */
export async function claimInformation(
  tx: Prisma.TransactionClient,
  informationId: string,
  playerId: string,
  crimeId: string,
  now: Date,
): Promise<boolean> {
  const result = await tx.information.updateMany({
    where: { id: informationId, ownerId: playerId, usedAt: null },
    data: { usedAt: now, usedOnCrimeId: crimeId },
  });

  return result.count === 1;
}

/**
 * Resolves what a claimed piece of information actually contributes.
 *
 * Information that turns out to be wrong is still consumed - the player spent
 * it - but adds nothing. That is the risk the system is built around.
 */
export function applyInformation(
  information: Information,
  bonusPoints: number,
): AppliedInformation {
  return {
    information,
    bonusPoints: information.isTrue ? bonusPoints : 0,
  };
}
