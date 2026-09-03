import type { Player, Transaction } from '@prisma/client';
import {
  CRIMES,
  CRIME_TUNING,
  effectiveSuccessChance,
  findCrime,
  formatDuration,
  resolveCrimeBlock,
  resolveDistrict,
  riskLabel,
  type CrimeStateDto,
  type DistrictDefinition,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, notFound } from '../../lib/errors';
import { pickOne, randomChance, rollRange } from '../../lib/random';
import { clamp, clampHealth, clampHeat } from '@skyggeby/shared';
import {
  applyLedgerEntriesTx,
  lockPlayer,
  type LedgerEntry,
} from '../economy/transaction.service';
import { grantXp, maxEnergyAfter, settleVitalsTx } from '../player/progression.service';
import {
  applyInformation,
  claimInformation,
  findBestInformation,
} from '../information/information.relevance';
import type { AppliedInformation } from '../information/information.types';
import {
  applyDistrictToRolls,
  applySkillsToFailure,
  districtSuccessChance,
  modifiersFor,
  scale,
  skillInformationBonus,
  skillSuccessChance,
} from './crime.modifiers';
import { getSkillEffects } from '../skills/skill.effects';
import { getSkillLevelsTx } from '../skills/skill.service';

export interface CrimeOutcome {
  crimeId: string;
  crimeName: string;
  districtId: string;
  districtName: string;
  success: boolean;
  story: string;
  headline: string;
  payout: number;
  fine: number;
  xpGained: number;
  heatChange: number;
  healthChange: number;
  energySpent: number;
  leveledUp: boolean;
  newLevel: number;
  cooldownSeconds: number;
  cooldownUntil: Date;
  performedAt: Date;
  /** Skill points granted by any level-up this attempt caused. */
  skillPointsGained: number;
  /** Information consumed by this attempt, if any. */
  information: AppliedInformation | null;
}

export interface PerformCrimeResult {
  outcome: CrimeOutcome;
  player: Player;
  transactions: Transaction[];
  district: DistrictDefinition;
}

/** Active cooldowns for a player, keyed by crime id. */
async function loadCooldowns(
  playerId: string,
  now: Date,
): Promise<Map<string, Date>> {
  const rows = await prisma.crimeAttempt.findMany({
    where: { playerId, cooldownUntil: { gt: now } },
    select: { crimeId: true, cooldownUntil: true },
    orderBy: { cooldownUntil: 'desc' },
  });

  const map = new Map<string, Date>();
  for (const row of rows) {
    if (!map.has(row.crimeId)) map.set(row.crimeId, row.cooldownUntil);
  }
  return map;
}

/** Builds the per-player view of the whole crime catalogue. */
export function buildCrimeState(
  player: Player,
  cooldowns: Map<string, Date>,
  now: Date = new Date(),
): CrimeStateDto[] {
  // The catalogue the player sees must already account for where they stand,
  // otherwise the displayed odds and payouts would be a lie.
  const district = resolveDistrict(player.currentDistrictId);
  const modifiers = modifiersFor(district);

  return CRIMES.map((crime) => {
    const unlocked = player.level >= crime.minLevel;
    const cooldownUntil = cooldowns.get(crime.id) ?? null;
    const remainingMs = cooldownUntil ? cooldownUntil.getTime() - now.getTime() : 0;
    const cooldownRemainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));

    const block = resolveCrimeBlock(crime, {
      level: player.level,
      energy: player.energy,
      health: player.health,
      cooldownRemainingSeconds,
    });

    const chance = districtSuccessChance(
      effectiveSuccessChance(crime, player.heat),
      modifiers,
    );

    return {
      id: crime.id,
      name: crime.name,
      description: crime.description,
      scene: crime.scene,
      minLevel: crime.minLevel,
      energyCost: crime.energyCost,
      cooldownSeconds: crime.cooldownSeconds,
      baseSuccessChance: crime.successChance,
      successChance: chance,
      riskLabel: riskLabel(chance),
      rewardMin: scale(crime.reward.min, modifiers.payout),
      rewardMax: scale(crime.reward.max, modifiers.payout),
      xpMin: scale(crime.xp.min, modifiers.xp),
      xpMax: scale(crime.xp.max, modifiers.xp),
      unlocked,
      available: block.reason === null,
      blockedReason: block.reason,
      blockedText: block.text,
      cooldownRemainingSeconds,
      cooldownUntil: cooldownRemainingSeconds > 0 && cooldownUntil
        ? cooldownUntil.toISOString()
        : null,
    } satisfies CrimeStateDto;
  });
}

export async function listCrimesForPlayer(player: Player): Promise<CrimeStateDto[]> {
  const now = new Date();
  const cooldowns = await loadCooldowns(player.id, now);
  return buildCrimeState(player, cooldowns, now);
}

/**
 * Executes one crime. This is the authoritative resolution: the client only
 * names the crime, everything else - eligibility, the dice roll, the reward,
 * the consequences and the bookkeeping - happens here, atomically.
 */
export async function performCrime(
  playerId: string,
  crimeId: string,
): Promise<PerformCrimeResult> {
  const crime = findCrime(crimeId);
  if (!crime) {
    throw notFound('Denne kriminaliteten finnes ikke.');
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();

    // Serialise every money/stat change for this player.
    await lockPlayer(tx, playerId);

    const loaded = await tx.player.findUnique({ where: { id: playerId } });
    if (!loaded) throw notFound('Fant ikke spilleren.');

    // Settle passive energy and heat before judging eligibility.
    const settled = await settleVitalsTx(tx, loaded, now);
    let player = settled.player;

    // The district comes from the locked database row, never from the request.
    const district = resolveDistrict(player.currentDistrictId);
    const modifiers = modifiersFor(district);

    // Skills, likewise, are read from the database inside the transaction and
    // turned into numbers by the one function allowed to do that.
    const skillEffects = getSkillEffects(await getSkillLevelsTx(tx, playerId));

    if (player.level < crime.minLevel) {
      throw new AppError(
        403,
        'FOR_LAVT_NIVA',
        `Du må være nivå ${crime.minLevel} for å prøve deg på ${crime.name.toLowerCase()}.`,
      );
    }

    if (player.health < CRIME_TUNING.minHealthToAct) {
      throw new AppError(
        400,
        'FOR_SKADET',
        `Du er for skadet til å jobbe. Du trenger minst ${CRIME_TUNING.minHealthToAct} i helse.`,
      );
    }

    const activeCooldown = await tx.crimeAttempt.findFirst({
      where: { playerId, crimeId: crime.id, cooldownUntil: { gt: now } },
      orderBy: { cooldownUntil: 'desc' },
      select: { cooldownUntil: true },
    });

    if (activeCooldown) {
      const remaining = Math.ceil(
        (activeCooldown.cooldownUntil.getTime() - now.getTime()) / 1000,
      );
      throw new AppError(
        429,
        'AVKJOLING_AKTIV',
        `Du må vente ${formatDuration(remaining)} før du kan gjøre dette igjen.`,
      );
    }

    if (player.energy < crime.energyCost) {
      throw new AppError(
        400,
        'FOR_LITE_ENERGI',
        `Du har ikke nok energi. ${crime.name} koster ${crime.energyCost}, du har ${player.energy}.`,
      );
    }

    // ---- Information ------------------------------------------------------
    // Claimed before the roll, so the same tip can never be spent twice: the
    // claim is a conditional update on `usedAt IS NULL`, and only the caller
    // that wins it gets the bonus. Information that turns out to be wrong is
    // still consumed - it just adds nothing.
    let information: AppliedInformation | null = null;

    const candidate = await findBestInformation(tx, playerId, crime.id, district.id, now);
    if (candidate) {
      const claimed = await claimInformation(
        tx,
        candidate.information.id,
        playerId,
        crime.id,
        now,
      );
      if (claimed) {
        information = applyInformation(
          candidate.information,
          skillInformationBonus(candidate.bonusPoints, skillEffects),
        );
      }
    }

    const informationBonus = information ? information.bonusPoints / 100 : 0;

    // ---- Resolution -------------------------------------------------------
    const baseChance = districtSuccessChance(
      effectiveSuccessChance(crime, player.heat),
      modifiers,
    );

    // The ceiling still applies after every bonus: district, information and
    // skill can improve the odds, never guarantee them.
    const withInformation = clamp(
      baseChance + informationBonus,
      CRIME_TUNING.minEffectiveChance,
      CRIME_TUNING.maxEffectiveChance,
    );
    const chance = skillSuccessChance(withInformation, skillEffects);

    const success = randomChance() < chance;

    const rolled = applyDistrictToRolls(
      {
        payout: success ? rollRange(crime.reward) : 0,
        xpGained: success ? rollRange(crime.xp) : rollRange(crime.failXp),
        heatChange: success
          ? rollRange(crime.heatOnSuccess)
          : rollRange(crime.heatOnFailure),
        healthLoss: success ? 0 : rollRange(crime.healthOnFailure),
        fine: success ? 0 : rollRange(crime.fineOnFailure),
      },
      modifiers,
    );

    // Motstandskraft is the one skill with a natural home in the existing
    // system: it softens what a failure costs, without touching the odds.
    const softened = applySkillsToFailure(
      { healthLoss: rolled.healthLoss, fine: rolled.fine },
      skillEffects,
    );

    const payout = rolled.payout;
    const xpGained = rolled.xpGained;
    const heatChange = rolled.heatChange;
    const healthLoss = softened.healthLoss;

    // A fine can never push a player into debt.
    const fine = Math.min(softened.fine, player.cash);

    const story = success
      ? pickOne(crime.successTexts, 'Det gikk bedre enn ventet.')
      : pickOne(crime.failureTexts, 'Det gikk galt.');

    // ---- Money ------------------------------------------------------------
    const entries: LedgerEntry[] = [];
    if (payout > 0) {
      entries.push({
        ledger: 'CASH',
        amount: payout,
        type: 'INNTEKT',
        source: `crime.${crime.id}`,
        description: `Utbytte fra ${crime.name.toLowerCase()} i ${district.name}`,
      });
    }
    if (fine > 0) {
      entries.push({
        ledger: 'CASH',
        amount: -fine,
        type: 'UTGIFT',
        source: `crime.${crime.id}.fine`,
        description: `Tap etter mislykket ${crime.name.toLowerCase()} i ${district.name}`,
      });
    }

    let transactions: Transaction[] = [];
    if (entries.length > 0) {
      const ledger = await applyLedgerEntriesTx(tx, playerId, entries, { skipLock: true });
      player = ledger.player;
      transactions = ledger.transactions;
    }

    // ---- Stats ------------------------------------------------------------
    const progression = grantXp(player.xp, player.level, xpGained);
    const newHeat = clampHeat(player.heat + heatChange);
    const newHealth = clampHealth(player.health - healthLoss);
    const newEnergy = Math.max(0, player.energy - crime.energyCost);

    // Applied heat/health can differ from the roll once clamped, so report the
    // real deltas back to the player rather than the dice.
    const appliedHeatChange = newHeat - player.heat;
    const appliedHealthChange = newHealth - player.health;

    const cooldownUntil = new Date(now.getTime() + crime.cooldownSeconds * 1000);

    player = await tx.player.update({
      where: { id: playerId },
      data: {
        energy: newEnergy,
        // Spending energy restarts the regeneration clock from a known point.
        energyUpdatedAt: player.energy >= player.maxEnergy ? now : player.energyUpdatedAt,
        heat: newHeat,
        heatUpdatedAt: player.heat === 0 && newHeat > 0 ? now : player.heatUpdatedAt,
        health: newHealth,
        xp: progression.xp,
        level: progression.level,
        // Granted by the same write as the level, so the two cannot drift.
        skillPoints: { increment: progression.skillPointsGained },
        maxEnergy: maxEnergyAfter(player.maxEnergy, progression.level),
      },
    });

    await tx.crimeAttempt.create({
      data: {
        playerId,
        crimeId: crime.id,
        districtId: district.id,
        success,
        payout,
        fine,
        xpGained,
        heatChange: appliedHeatChange,
        healthChange: appliedHealthChange,
        energySpent: crime.energyCost,
        chanceBps: Math.round(chance * 10000),
        informationId: information?.information.id ?? null,
        informationBonus: Math.round((information?.bonusPoints ?? 0) * 10),
        cooldownUntil,
      },
    });

    const outcome: CrimeOutcome = {
      crimeId: crime.id,
      crimeName: crime.name,
      districtId: district.id,
      districtName: district.name,
      success,
      story,
      headline: success ? 'Vellykket' : 'Mislyktes',
      payout,
      fine,
      xpGained,
      heatChange: appliedHeatChange,
      healthChange: appliedHealthChange,
      energySpent: crime.energyCost,
      leveledUp: progression.leveledUp,
      newLevel: progression.level,
      skillPointsGained: progression.skillPointsGained,
      cooldownSeconds: crime.cooldownSeconds,
      cooldownUntil,
      performedAt: now,
      information,
    };

    return { outcome, player, transactions, district };
  });
}
