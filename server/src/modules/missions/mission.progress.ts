/**
 * Advancing missions when something actually happens.
 *
 * This is the only part of the mission system that reaches into the rest of the
 * game, and it is deliberately the smallest part. Each existing service - crime,
 * exploration, travel, driving, talking, banking - reports what it just did, and
 * this module decides whether any running mission cared.
 *
 * Three rules keep it safe to call from inside somebody else's transaction:
 *
 *  - It takes no lock of its own. Every call site already holds the player's
 *    row lock, so adding a second lock here would introduce a new ordering and
 *    with it a deadlock nobody would find until production.
 *  - It only ever touches `missions`, and only rows belonging to the player the
 *    caller is already working on.
 *  - It never decides anything a player can see beyond a counter. Whether the
 *    mission is finished is answered at delivery, by the evaluator, against the
 *    world as it stands.
 *
 * The counter is guarded by `progressCount < target` and only ever credited
 * with the shortfall, so an event that arrives after a mission is already
 * satisfied changes nothing, and one that overshoots stops exactly on the
 * target. The stored number can never exceed what the objective asked for.
 */
import type { Prisma } from '@prisma/client';
import {
  eventObjectiveOf,
  findMission,
  objectiveTarget,
  type InformationRelevance,
  type MissionObjective,
} from '@skyggeby/shared';

/** What a service reports having happened. Never sent by a client. */
export type MissionEvent =
  | { kind: 'KRIM'; crimeId: string; districtId: string; success: boolean }
  | { kind: 'UTFORSK'; districtId: string; relevance: InformationRelevance | null }
  | { kind: 'PRAT'; contactId: string }
  | { kind: 'KJOR'; districtId: string }
  | { kind: 'INNSKUDD'; amount: number };

/**
 * Whether one event satisfies one objective.
 *
 * Unspecified fields on the objective mean "anywhere" or "any": a mission that
 * does not name a district is happy wherever it happened.
 */
function matches(objective: MissionObjective, event: MissionEvent): boolean {
  if (objective.kind !== event.kind) return false;

  switch (event.kind) {
    case 'KRIM':
      if (objective.kind !== 'KRIM') return false;
      // A failed attempt is not progress. The crime already charged energy and
      // handed out heat for it; the mission simply does not count it.
      if (!event.success) return false;
      if (objective.crimeId !== event.crimeId) return false;
      return !objective.districtId || objective.districtId === event.districtId;

    case 'UTFORSK':
      if (objective.kind !== 'UTFORSK') return false;
      if (objective.districtId && objective.districtId !== event.districtId) return false;
      if (objective.relevance && objective.relevance !== event.relevance) return false;
      return true;

    case 'PRAT':
      return objective.kind === 'PRAT' && objective.contactId === event.contactId;

    case 'KJOR':
      return objective.kind === 'KJOR' && objective.districtId === event.districtId;

    case 'INNSKUDD':
      return objective.kind === 'INNSKUDD';

    default:
      return false;
  }
}

/** How much this event moves the counter. */
function amountOf(event: MissionEvent): number {
  return event.kind === 'INNSKUDD' ? event.amount : 1;
}

/**
 * Records an event against every running mission that wants it.
 *
 * Returns the ids of the missions that moved, which the calling service can
 * pass back so the interface can say "det talte for et oppdrag" without the
 * player having to go and look.
 *
 * Never throws for game reasons: an event that matches nothing is the normal
 * case, and a mission whose catalogue entry has since disappeared is skipped
 * rather than treated as an error.
 */
export async function advanceMissionProgressTx(
  tx: Prisma.TransactionClient,
  playerId: string,
  event: MissionEvent,
  now: Date = new Date(),
): Promise<string[]> {
  const active = await tx.mission.findMany({
    where: { playerId, status: 'AKTIV' },
    select: { id: true, missionId: true, expiresAt: true, progressCount: true },
  });

  if (active.length === 0) return [];

  const advanced: string[] = [];

  for (const row of active) {
    // An expired mission is not advanced. Cleaning it up is the reader's job,
    // not this one's: a crime should never fail because a deadline passed.
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) continue;

    const mission = findMission(row.missionId);
    if (!mission) continue;

    const objective = eventObjectiveOf(mission);
    if (!objective || !matches(objective, event)) continue;

    const target = objectiveTarget(objective);
    if (row.progressCount >= target) continue;

    // Only the shortfall is credited, so a single large event - a 20 000 kr
    // deposit against a 5 000 kr objective - lands whole in the bank but stops
    // the counter exactly on the target rather than a few thousand past it.
    // The row was read under the player's lock, which every call site already
    // holds, so the shortfall cannot be stale.
    const delta = Math.min(amountOf(event), target - row.progressCount);
    if (delta <= 0) continue;

    // Still one atomic increment behind the same guard: the write semantics are
    // untouched, only the amount is bounded. The guard remains part of the
    // statement so the counter stops at the target even if two events for the
    // same player somehow arrived together.
    const moved = await tx.mission.updateMany({
      where: { id: row.id, status: 'AKTIV', progressCount: { lt: target } },
      data: { progressCount: { increment: delta } },
    });

    if (moved.count === 1) advanced.push(row.missionId);
  }

  return advanced;
}
