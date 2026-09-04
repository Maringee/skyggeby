/**
 * Accepting, delivering and abandoning missions.
 *
 * Every rule in here is server-side, and every one of them is checked twice:
 * once when the mission is taken on, and again when it is handed in. Accepting
 * is not a ticket - a player who sold the car, spent the money or left the
 * district in between has not done the job.
 *
 * The order of a delivery matters and is deliberate:
 *
 *   1. lock the player's row
 *   2. re-read the world
 *   3. re-check requirements and objectives
 *   4. *claim* the mission with a conditional update that must move exactly one
 *      row, before a single krone moves
 *   5. only then pay
 *
 * Step 4 before step 5 is what makes twenty simultaneous deliveries pay once.
 * If the claim moves no rows, somebody else already took it and the whole
 * transaction rolls back with nothing paid.
 */
import type { Mission, Player, Prisma, Transaction } from '@prisma/client';
import {
  INFORMATION_BALANCE,
  MISSIONS,
  MISSION_TUNING,
  clampHeat,
  computeBaseValue,
  findContact,
  findMission,
  isChainOpener,
  TRUST_TUNING,
  resolveDistrict,
  type InformationRelevance,
  type MissionDefinition,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, notFound } from '../../lib/errors';
import {
  applyLedgerEntriesTx,
  lockPlayer,
  type LedgerEntry,
} from '../economy/transaction.service';
import { grantXp, maxEnergyAfter, settleVitalsTx } from '../player/progression.service';
import { getSkillLevelsTx } from '../skills/skill.service';
import {
  evaluateObjectives,
  evaluateRequirements,
  type ConditionResult,
  type MissionContext,
  type ObjectiveResult,
} from './mission.requirements';

/**
 * Trust an introduced contact starts at.
 *
 * The same as meeting somebody the ordinary way: an introduction gets you in
 * the door, not into their confidence.
 */
const TRUST_ON_INTRODUCTION = TRUST_TUNING.start;

/* ------------------------------------------------------------------ *
 * Context
 * ------------------------------------------------------------------ */

/**
 * Loads everything the evaluator is allowed to see, in one pass.
 *
 * Read inside whatever transaction the caller opened, so a delivery judges the
 * same world it is about to change. Deliberately bounded: a player with a
 * thousand assets should not turn a mission list into a table scan.
 */
async function loadContextTx(
  tx: Prisma.TransactionClient,
  player: Player,
  now: Date,
): Promise<MissionContext> {
  // Skills come from the one function allowed to read them, so a mission sees
  // exactly what the skill screen and the crime roll see.
  const skillLevels = await getSkillLevelsTx(tx, player.id);

  const [relationships, completed, assets, vehicles, businesses, properties, knowledge] =
    await Promise.all([
      tx.contactRelationship.findMany({
        where: { playerId: player.id },
        select: { contactId: true, trust: true },
      }),
      tx.mission.findMany({
        where: { playerId: player.id, status: 'FULLFORT' },
        select: { missionId: true },
      }),
      tx.asset.findMany({ where: { playerId: player.id }, take: 500 }),
      tx.vehicle.findMany({
        where: { playerId: player.id },
        select: {
          vehicleTypeId: true,
          locationDistrictId: true,
          asset: { select: { condition: true } },
        },
      }),
      tx.business.findMany({
        where: { playerId: player.id },
        select: { districtId: true },
      }),
      tx.property.findMany({
        where: { playerId: player.id },
        select: { districtId: true },
      }),
      // Only what could still count: spent or expired knowledge can never
      // satisfy an objective, so it is not worth carrying around.
      tx.information.findMany({
        where: { ownerId: player.id, usedAt: null },
        select: {
          relevance: true,
          districtId: true,
          discoveredAt: true,
          expiresAt: true,
          usedAt: true,
        },
        take: 300,
      }),
    ]);

  return {
    player,
    now,
    trustByContact: new Map(relationships.map((row) => [row.contactId, row.trust])),
    completedMissionIds: new Set(completed.map((row) => row.missionId)),
    assets,
    vehicles: vehicles.map((row) => ({
      vehicleTypeId: row.vehicleTypeId,
      districtId: row.locationDistrictId,
      // Condition lives on the asset, which is where a vehicle's worth and
      // wear have always lived. The vehicle row only knows where it stands.
      condition: row.asset.condition,
    })),
    businessDistrictIds: businesses.map((row) => row.districtId),
    propertyDistrictIds: properties.map((row) => row.districtId),
    knowledge: knowledge.map((row) => ({
      relevance: row.relevance as InformationRelevance,
      districtId: row.districtId,
      discoveredAt: row.discoveredAt,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
    })),
    skillLevels,
  };
}

/* ------------------------------------------------------------------ *
 * Availability
 * ------------------------------------------------------------------ */

/** The stored rows for one mission, newest first where it matters. */
interface MissionHistory {
  active: Mission | null;
  completedAt: Date | null;
  /** When the player last walked away from it, abandoned or expired. */
  releasedAt: Date | null;
}

function historyFor(rows: Mission[], missionId: string): MissionHistory {
  const mine = rows.filter((row) => row.missionId === missionId);

  const completed = mine
    .filter((row) => row.status === 'FULLFORT' && row.completedAt)
    .map((row) => row.completedAt as Date)
    .sort((a, b) => b.getTime() - a.getTime());

  const released = mine
    .filter((row) => row.status === 'AVBRUTT' || row.status === 'UTLOPT')
    .map((row) => row.updatedAt)
    .sort((a, b) => b.getTime() - a.getTime());

  return {
    active: mine.find((row) => row.status === 'AKTIV') ?? null,
    completedAt: completed[0] ?? null,
    releasedAt: released[0] ?? null,
  };
}

export interface MissionView {
  definition: MissionDefinition;
  availability:
    | 'TILGJENGELIG'
    | 'LAAST'
    | 'AKTIV'
    | 'FULLFORT'
    | 'SPERRET'
    | 'SKJULT';
  row: Mission | null;
  /** When it was last finished, for the history list. */
  completedAt: Date | null;
  conditions: ConditionResult[];
  objectives: ObjectiveResult[];
  /** True when every objective is met and the mission can be handed in. */
  deliverable: boolean;
  /** One line saying what stands in the way, or null. */
  blockedReason: string | null;
  /** Seconds until a blocked mission opens again, when that is the reason. */
  blockedSeconds: number;
}

function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 1000));
}

/**
 * Works out where one mission stands for one player.
 *
 * The order of the checks is the order the player experiences them. Missions
 * from people they have not met, and later links of chains they have not
 * started, are hidden rather than locked: a chain should reveal itself, and a
 * list of jobs from strangers would give away the whole contact network.
 * Everything else is shown, with the reason it is not available - a locked
 * mission the player can read is a goal, a hidden one is nothing.
 */
function viewFor(
  mission: MissionDefinition,
  context: MissionContext,
  rows: Mission[],
): MissionView {
  const history = historyFor(rows, mission.id);
  const now = context.now;

  const base = {
    definition: mission,
    row: history.active,
    completedAt: history.completedAt,
    conditions: [] as ConditionResult[],
    objectives: [] as ObjectiveResult[],
    deliverable: false,
    blockedReason: null as string | null,
    blockedSeconds: 0,
  };

  if (history.active) {
    const evaluation = evaluateObjectives(mission, context, history.active.progressCount);
    const requirements = evaluateRequirements(mission, context);

    return {
      ...base,
      availability: 'AKTIV',
      conditions: requirements.conditions,
      objectives: evaluation.objectives,
      // Both halves must hold: the work done *and* the door still open.
      deliverable: evaluation.complete && requirements.eligible,
      blockedReason: evaluation.missingReason ?? requirements.blockedReason,
      blockedSeconds: history.active.expiresAt
        ? secondsBetween(now, history.active.expiresAt)
        : 0,
    };
  }

  // Somebody the player has never met offers them nothing.
  if (!context.trustByContact.has(mission.contactId)) {
    return { ...base, availability: 'SKJULT' };
  }

  // A later link of a chain stays out of sight until its predecessor is done.
  if (
    !isChainOpener(mission) &&
    !mission.requiresMissions.every((id) => context.completedMissionIds.has(id))
  ) {
    return { ...base, availability: 'SKJULT' };
  }

  if (history.completedAt) {
    if (!mission.repeatable) {
      return { ...base, availability: 'FULLFORT' };
    }

    const cooldown = mission.repeatCooldownSeconds ?? 0;
    const opensAt = new Date(history.completedAt.getTime() + cooldown * 1000);
    if (opensAt > now) {
      return {
        ...base,
        availability: 'SPERRET',
        blockedReason: `${findContact(mission.contactId)?.name ?? 'Kontakten'} trenger ikke dette igjen ennå.`,
        blockedSeconds: secondsBetween(now, opensAt),
      };
    }
  }

  // Walking away has a cost, or accepting and abandoning would be a way to
  // reset a deadline for free.
  if (history.releasedAt) {
    const wait = MISSION_TUNING.abandonCooldownSeconds;
    const opensAt = new Date(history.releasedAt.getTime() + wait * 1000);
    if (opensAt > now) {
      return {
        ...base,
        availability: 'SPERRET',
        blockedReason: 'Du forlot dette oppdraget nylig. Vent litt før du tar det igjen.',
        blockedSeconds: secondsBetween(now, opensAt),
      };
    }
  }

  const requirements = evaluateRequirements(mission, context);
  const objectives = evaluateObjectives(mission, context, 0);

  return {
    ...base,
    availability: requirements.eligible ? 'TILGJENGELIG' : 'LAAST',
    conditions: requirements.conditions,
    objectives: objectives.objectives,
    blockedReason: requirements.blockedReason,
  };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export interface MissionOverview {
  player: Player;
  /** Everything the player is allowed to see. Hidden missions are not here. */
  views: MissionView[];
  activeCount: number;
  maxActive: number;
  /** How many could be handed in right now. Drives the badge in the menu. */
  deliverableCount: number;
  /**
   * Chain links waiting behind a mission the player has not finished, from
   * people they already know. Rendered as "denne kjeden fortsetter" rather than
   * as a list: the chain should still have something left to reveal.
   */
  chainContinues: number;
}

async function buildOverviewTx(
  tx: Prisma.TransactionClient,
  player: Player,
  now: Date,
): Promise<MissionOverview> {
  const context = await loadContextTx(tx, player, now);
  const rows = await tx.mission.findMany({ where: { playerId: player.id }, take: 500 });

  const all = MISSIONS.map((mission) => viewFor(mission, context, rows));
  const views = all.filter((view) => view.availability !== 'SKJULT');

  const chainContinues = all.filter(
    (view) =>
      view.availability === 'SKJULT' &&
      context.trustByContact.has(view.definition.contactId) &&
      !isChainOpener(view.definition),
  ).length;

  return {
    player,
    views,
    activeCount: views.filter((view) => view.availability === 'AKTIV').length,
    maxActive: MISSION_TUNING.maxActive,
    deliverableCount: views.filter((view) => view.deliverable).length,
    chainContinues,
  };
}

/**
 * The whole picture for one player.
 *
 * Runs in a transaction because expired missions are retired on the way past:
 * there is no cron in Skyggeby, and a deadline that nobody looks at has not
 * really passed.
 */
export async function listMissions(playerId: string): Promise<MissionOverview> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await lockPlayer(tx, playerId);

    const loaded = await tx.player.findUnique({ where: { id: playerId } });
    if (!loaded) throw notFound('Fant ikke spilleren.');

    const settled = await settleVitalsTx(tx, loaded, now);
    await retireExpiredTx(tx, playerId, now);

    return buildOverviewTx(tx, settled.player, now);
  });
}

/**
 * Retires missions whose deadline has passed.
 *
 * Lazy, like the businesses' settlement: computed from a timestamp when
 * somebody looks, never by a background job. The update is conditional on the
 * row still being AKTIV, so it is safe to call from anywhere.
 */
async function retireExpiredTx(
  tx: Prisma.TransactionClient,
  playerId: string,
  now: Date,
): Promise<number> {
  const result = await tx.mission.updateMany({
    where: { playerId, status: 'AKTIV', expiresAt: { not: null, lte: now } },
    data: { status: 'UTLOPT' },
  });
  return result.count;
}

/** One mission, with the same view the list would give. */
export async function getMission(
  playerId: string,
  missionId: string,
): Promise<{ player: Player; view: MissionView }> {
  const definition = findMission(missionId);
  if (!definition) throw notFound('Dette oppdraget finnes ikke.');

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await lockPlayer(tx, playerId);

    const loaded = await tx.player.findUnique({ where: { id: playerId } });
    if (!loaded) throw notFound('Fant ikke spilleren.');

    const settled = await settleVitalsTx(tx, loaded, now);
    await retireExpiredTx(tx, playerId, now);

    const context = await loadContextTx(tx, settled.player, now);
    const rows = await tx.mission.findMany({
      where: { playerId, missionId },
      take: 100,
    });

    const view = viewFor(definition, context, rows);

    // A mission the player cannot see answers the same way one that does not
    // exist does, so an id alone reveals nothing about the contact network.
    if (view.availability === 'SKJULT') {
      throw notFound('Dette oppdraget finnes ikke.');
    }

    return { player: settled.player, view };
  });
}

/* ------------------------------------------------------------------ *
 * Accepting
 * ------------------------------------------------------------------ */

export interface AcceptResult {
  player: Player;
  mission: Mission;
  overview: MissionOverview;
  message: string;
}

/**
 * Takes a mission on.
 *
 * Costs nothing - no energy, no money. The price of a mission is the work it
 * asks for, and charging to accept one would only teach players not to.
 *
 * The active count is read under the player's row lock, and the partial unique
 * index on (playerId, missionId) WHERE status = 'AKTIV' is the backstop: even
 * if two requests somehow passed the count together, only one row can exist.
 */
export async function acceptMission(
  playerId: string,
  missionId: string,
): Promise<AcceptResult> {
  const definition = findMission(missionId);
  if (!definition) throw notFound('Dette oppdraget finnes ikke.');

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await lockPlayer(tx, playerId);

    const loaded = await tx.player.findUnique({ where: { id: playerId } });
    if (!loaded) throw notFound('Fant ikke spilleren.');

    const settled = await settleVitalsTx(tx, loaded, now);
    const player = settled.player;

    await retireExpiredTx(tx, playerId, now);

    const context = await loadContextTx(tx, player, now);
    const rows = await tx.mission.findMany({ where: { playerId }, take: 500 });
    const view = viewFor(definition, context, rows);

    switch (view.availability) {
      case 'AKTIV':
        throw new AppError(409, 'ALLEREDE_AKTIVT', 'Du holder allerede på med dette oppdraget.');
      case 'FULLFORT':
        throw new AppError(409, 'ALLEREDE_FULLFORT', 'Du har allerede gjort dette.');
      case 'SPERRET':
        throw new AppError(
          409,
          'SPERRET',
          view.blockedReason ?? 'Dette oppdraget er ikke tilgjengelig ennå.',
        );
      case 'SKJULT':
        // Same answer as an unknown id: nothing is revealed either way.
        throw notFound('Dette oppdraget finnes ikke.');
      case 'LAAST':
        throw new AppError(
          403,
          'KRAV_IKKE_OPPFYLT',
          view.blockedReason ?? 'Du oppfyller ikke kravene for dette oppdraget.',
        );
      default:
        break;
    }

    const activeCount = rows.filter((row) => row.status === 'AKTIV').length;
    if (activeCount >= MISSION_TUNING.maxActive) {
      throw new AppError(
        400,
        'FOR_MANGE_AKTIVE',
        `Du kan ha ${MISSION_TUNING.maxActive} oppdrag om gangen. Du har ${activeCount}. Fullfør eller avbryt ett først.`,
      );
    }

    const mission = await tx.mission.create({
      data: {
        playerId,
        missionId: definition.id,
        contactId: definition.contactId,
        status: 'AKTIV',
        acceptedAt: now,
        expiresAt: definition.expiresInSeconds
          ? new Date(now.getTime() + definition.expiresInSeconds * 1000)
          : null,
      },
    });

    const contactName = findContact(definition.contactId)?.name ?? 'Kontakten';

    return {
      player,
      mission,
      overview: await buildOverviewTx(tx, player, now),
      message: `Du tok oppdraget «${definition.name}» fra ${contactName}.`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Abandoning
 * ------------------------------------------------------------------ */

export interface AbandonResult {
  player: Player;
  overview: MissionOverview;
  message: string;
}

/**
 * Walks away from a mission.
 *
 * No penalty beyond the wait before it can be taken again. Nothing is
 * confiscated and nothing is lost - the energy and the time already went into
 * whatever was actually done.
 */
export async function abandonMission(
  playerId: string,
  missionId: string,
): Promise<AbandonResult> {
  const definition = findMission(missionId);
  if (!definition) throw notFound('Dette oppdraget finnes ikke.');

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await lockPlayer(tx, playerId);

    const loaded = await tx.player.findUnique({ where: { id: playerId } });
    if (!loaded) throw notFound('Fant ikke spilleren.');

    const settled = await settleVitalsTx(tx, loaded, now);

    // The update is the claim: two simultaneous requests cannot both abandon
    // the same mission, and the second finds nothing to change.
    const released = await tx.mission.updateMany({
      where: { playerId, missionId, status: 'AKTIV' },
      data: { status: 'AVBRUTT' },
    });

    if (released.count !== 1) {
      throw new AppError(409, 'IKKE_AKTIVT', 'Du holder ikke på med dette oppdraget.');
    }

    const minutes = Math.round(MISSION_TUNING.abandonCooldownSeconds / 60);

    return {
      player: settled.player,
      overview: await buildOverviewTx(tx, settled.player, now),
      message: `Du forlot «${definition.name}». Du kan ta det igjen om ${minutes} minutter.`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Delivering
 * ------------------------------------------------------------------ */

export interface UnlockReport {
  missions: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; name: string }>;
}

export interface DeliverResult {
  player: Player;
  mission: Mission;
  transactions: Transaction[];
  overview: MissionOverview;
  cash: number;
  xpGained: number;
  trustGained: number;
  heatChange: number;
  leveledUp: boolean;
  newLevel: number;
  skillPointsGained: number;
  /** Whether a guaranteed piece of knowledge was handed over. */
  informationGiven: boolean;
  unlocked: UnlockReport;
  /** What the contact says. */
  debriefing: string;
  message: string;
}

/**
 * Hands a mission in.
 *
 * Requirements and objectives are both re-evaluated here against the freshly
 * locked row. The claim - a conditional update that must move exactly one row -
 * happens before any payment, so a second request racing this one finds the
 * mission already finished and rolls back having paid nothing.
 */
export async function deliverMission(
  playerId: string,
  missionId: string,
): Promise<DeliverResult> {
  const definition = findMission(missionId);
  if (!definition) throw notFound('Dette oppdraget finnes ikke.');

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await lockPlayer(tx, playerId);

    const loaded = await tx.player.findUnique({ where: { id: playerId } });
    if (!loaded) throw notFound('Fant ikke spilleren.');

    const settled = await settleVitalsTx(tx, loaded, now);
    let player = settled.player;

    const row = await tx.mission.findFirst({
      where: { playerId, missionId, status: 'AKTIV' },
    });

    if (!row) {
      throw new AppError(409, 'IKKE_AKTIVT', 'Du holder ikke på med dette oppdraget.');
    }

    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
      await tx.mission.updateMany({
        where: { id: row.id, status: 'AKTIV' },
        data: { status: 'UTLOPT' },
      });
      throw new AppError(409, 'UTLOPT', 'Fristen for dette oppdraget har gått ut.');
    }

    const context = await loadContextTx(tx, player, now);

    // The doorway is checked again, not just the work. Selling the car after
    // accepting is not a way past a requirement.
    const requirements = evaluateRequirements(definition, context);
    if (!requirements.eligible) {
      throw new AppError(
        403,
        'KRAV_IKKE_OPPFYLT',
        requirements.blockedReason ?? 'Du oppfyller ikke lenger kravene.',
      );
    }

    const objectives = evaluateObjectives(definition, context, row.progressCount);
    if (!objectives.complete) {
      // Not a failure and not a punishment: the mission stays active and the
      // player is told exactly what is left.
      throw new AppError(
        400,
        'IKKE_FERDIG',
        objectives.missingReason ?? 'Du er ikke ferdig med oppdraget ennå.',
      );
    }

    /* ---- the claim, before anything is paid ---- */
    const claimed = await tx.mission.updateMany({
      where: { id: row.id, playerId, status: 'AKTIV' },
      data: { status: 'FULLFORT', completedAt: now },
    });

    if (claimed.count !== 1) {
      throw new AppError(409, 'ALLEREDE_LEVERT', 'Dette oppdraget er allerede levert.');
    }

    /* ---- money ---- */
    const rewards = definition.rewards;
    let transactions: Transaction[] = [];

    if (rewards.cash > 0) {
      const entries: LedgerEntry[] = [
        {
          ledger: 'CASH',
          amount: rewards.cash,
          type: 'OPPDRAG',
          source: `mission.${definition.id}`,
          description: `Betaling for «${definition.name}»`,
        },
      ];
      const ledger = await applyLedgerEntriesTx(tx, playerId, entries, { skipLock: true });
      player = ledger.player;
      transactions = ledger.transactions;
    }

    /* ---- experience, heat ---- */
    const progression = grantXp(player.xp, player.level, rewards.xp);
    const newHeat = clampHeat(player.heat + rewards.heatChange);

    player = await tx.player.update({
      where: { id: playerId },
      data: {
        xp: progression.xp,
        level: progression.level,
        skillPoints: { increment: progression.skillPointsGained },
        maxEnergy: maxEnergyAfter(player.maxEnergy, progression.level),
        heat: newHeat,
        heatUpdatedAt: player.heat === 0 && newHeat > 0 ? now : player.heatUpdatedAt,
      },
    });

    /* ---- trust ---- */
    let trustGained = 0;
    if (rewards.trust > 0) {
      const relationship = await tx.contactRelationship.findFirst({
        where: { playerId, contactId: definition.contactId },
      });

      if (relationship) {
        const next = Math.min(100, Math.max(0, relationship.trust + rewards.trust));
        trustGained = next - relationship.trust;
        await tx.contactRelationship.update({
          where: { id: relationship.id },
          data: { trust: next, lastInteractionAt: now },
        });
      }
    }

    /* ---- knowledge ---- */
    // A tip from somebody who owes you a favour, not something you found. It is
    // true: paying a contact and being lied to is a punishment this version of
    // the game does not hand out.
    let informationGiven = false;
    if (rewards.information) {
      const district = resolveDistrict(rewards.information.districtId);
      const balance = INFORMATION_BALANCE.ETTERRETNING;
      const reliability = 85;
      const contactName = findContact(definition.contactId)?.name ?? 'En kontakt';

      await tx.information.create({
        data: {
          ownerId: playerId,
          type: 'ETTERRETNING',
          source: 'KONTAKT',
          relevance: rewards.information.relevance,
          title: `Fra ${contactName}`,
          content: `${contactName} fortalte deg hva som gjelder i ${district.name}. Det er verdt å bruke mens det er ferskt.`,
          districtId: district.id,
          reliability,
          isTrue: true,
          baseValue: computeBaseValue({
            type: 'ETTERRETNING',
            reliability,
            districtActivity: district.activity,
          }),
          discoveredAt: now,
          expiresAt: new Date(now.getTime() + balance.lifetimeMinutes * 60 * 1000),
        },
      });
      informationGiven = true;
    }

    /* ---- unlocks ---- */
    const unlocked = await applyUnlocksTx(tx, playerId, definition, context, now);

    const mission = await tx.mission.findUniqueOrThrow({ where: { id: row.id } });

    return {
      player,
      mission,
      transactions,
      overview: await buildOverviewTx(tx, player, now),
      cash: rewards.cash,
      xpGained: rewards.xp,
      trustGained,
      heatChange: newHeat - settled.player.heat,
      leveledUp: progression.leveledUp,
      newLevel: progression.level,
      skillPointsGained: progression.skillPointsGained,
      informationGiven,
      unlocked,
      debriefing: definition.debriefing,
      message: `Du fullførte «${definition.name}».`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Unlocks
 * ------------------------------------------------------------------ */

/**
 * Applies what finishing a mission opens up, and reports it.
 *
 * Unlocking is meant to feel like a reward rather than a flag, so it is a real
 * change to the player's world: an unlocked contact becomes an actual
 * relationship row, because that person now seeks the player out. They start at
 * the same trust anyone else would - being introduced gets you the meeting, not
 * the friendship.
 *
 * Missions need nothing written: a chain reads `requiresMissions` against the
 * completed rows. They are reported anyway, because "et nytt oppdrag åpnet seg"
 * is the part the player cares about.
 */
async function applyUnlocksTx(
  tx: Prisma.TransactionClient,
  playerId: string,
  definition: MissionDefinition,
  context: MissionContext,
  now: Date,
): Promise<UnlockReport> {
  const contacts: Array<{ id: string; name: string }> = [];

  for (const contactId of definition.unlocks.contactIds) {
    // Somebody the player already knows is not news, and must not be reported
    // as if it were.
    if (context.trustByContact.has(contactId)) continue;

    const contact = findContact(contactId);
    if (!contact) continue;

    // skipDuplicates leans on the (playerId, contactId) unique constraint, so
    // two deliveries racing each other cannot introduce the same person twice.
    const created = await tx.contactRelationship.createMany({
      data: [
        {
          playerId,
          contactId,
          trust: TRUST_ON_INTRODUCTION,
          status: 'AVAILABLE',
          discoveredAt: now,
        },
      ],
      skipDuplicates: true,
    });

    if (created.count === 1) contacts.push({ id: contactId, name: contact.name });
  }

  const missions = definition.unlocks.missionIds
    .map((id) => findMission(id))
    .filter((mission): mission is MissionDefinition => mission !== undefined)
    .map((mission) => ({ id: mission.id, name: mission.name }));

  return { missions, contacts };
}
