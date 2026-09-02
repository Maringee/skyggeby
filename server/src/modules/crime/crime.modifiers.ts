import {
  CRIME_TUNING,
  INFORMATION_TUNING,
  clamp,
  districtModifiers,
  type DistrictDefinition,
  type DistrictModifiers,
} from '@skyggeby/shared';
import type { ResolvedSkillEffects } from '../skills/skill.effects';

/**
 * The single place where a district's modifiers are applied to crime numbers.
 *
 * Keeping it here means the crime service never branches on a district id, and
 * a new district automatically affects crime through the catalogue alone.
 */

/** Scales an integer game value, never below zero. */
export function scale(value: number, multiplier: number): number {
  return Math.max(0, Math.round(value * multiplier));
}

export function modifiersFor(district: DistrictDefinition): DistrictModifiers {
  return districtModifiers(district);
}

/**
 * Adjusts a success chance for the district, then clamps it.
 *
 * The upper bound matters: without it a quiet district could push an easy job
 * to near-certainty, which would flatten the risk curve the crime balance is
 * built on.
 */
export function districtSuccessChance(
  baseChance: number,
  modifiers: DistrictModifiers,
): number {
  return clamp(
    baseChance * modifiers.success,
    CRIME_TUNING.minEffectiveChance,
    CRIME_TUNING.maxEffectiveChance,
  );
}

export interface CrimeRolls {
  payout: number;
  xpGained: number;
  heatChange: number;
  healthLoss: number;
  fine: number;
}

/** Applies the district to a set of freshly rolled crime outcomes. */
export function applyDistrictToRolls(
  rolls: CrimeRolls,
  modifiers: DistrictModifiers,
): CrimeRolls {
  return {
    payout: scale(rolls.payout, modifiers.payout),
    xpGained: scale(rolls.xpGained, modifiers.xp),
    heatChange: scale(rolls.heatChange, modifiers.heat),
    healthLoss: scale(rolls.healthLoss, modifiers.healthLoss),
    fine: scale(rolls.fine, modifiers.fine),
  };
}

/* ------------------------------------------------------------------ *
 * Skills
 * ------------------------------------------------------------------ */

/**
 * Applies the player's skills to a crime.
 *
 * Kept here with the district modifiers so the crime service never reads a
 * skill level itself - it asks for a finished number. The chance is clamped to
 * the same ceiling as everything else, so no combination of district,
 * information and skill can push a job past `maxEffectiveChance`.
 */
export function skillSuccessChance(
  chance: number,
  effects: ResolvedSkillEffects,
): number {
  return clamp(
    chance + effects.crimeSuccessPoints / 100,
    CRIME_TUNING.minEffectiveChance,
    CRIME_TUNING.maxEffectiveChance,
  );
}

/**
 * Amplifies the bonus a piece of information gives.
 *
 * Bounded by the information system's own ceiling afterwards: Etterretning can
 * get more out of a tip, never more than information is ever allowed to give.
 */
export function skillInformationBonus(
  bonusPoints: number,
  effects: ResolvedSkillEffects,
): number {
  const boosted = bonusPoints * (1 + effects.informationBonusBoost);
  return Math.min(INFORMATION_TUNING.maxBonusPercentagePoints, Math.round(boosted * 10) / 10);
}

/** Reduces what a failed job costs in health and cash. */
export function applySkillsToFailure(
  rolls: { healthLoss: number; fine: number },
  effects: ResolvedSkillEffects,
): { healthLoss: number; fine: number } {
  return {
    healthLoss: Math.max(0, Math.round(rolls.healthLoss * (1 - effects.damageReduction))),
    fine: Math.max(0, Math.round(rolls.fine * (1 - effects.fineReduction))),
  };
}
