import {
  SKILLS,
  SKILL_TUNING,
  clampSkillLevel,
  findSkill,
  formatPoints,
  skillEffectValue,
  type SkillId,
} from '@skyggeby/shared';
import { EFFECT_KEYS, SKILL_EFFECT_CAPS, type SkillEffectCaps } from './skill.catalog';

/**
 * The single place a skill level becomes a gameplay number.
 *
 * Nothing else in the codebase may read a level and decide what it is worth.
 * Every effect is `cap x curve(level)`, so a level can never produce a value
 * above its cap no matter what is stored, and level 0 always produces exactly
 * zero.
 */

export type SkillLevels = Partial<Record<SkillId, number>>;

/** Resolved effects, summed across every skill that contributes to each one. */
export type ResolvedSkillEffects = SkillEffectCaps;

/** What one skill at one level contributes. */
export function getSkillEffect(skillId: SkillId, level: number): SkillEffectCaps {
  const definition = findSkill(skillId);
  const caps = SKILL_EFFECT_CAPS[skillId];
  const maxLevel = definition?.maxLevel ?? SKILL_TUNING.maxLevel;
  const clamped = clampSkillLevel(level, maxLevel);

  const result = {} as SkillEffectCaps;
  for (const key of EFFECT_KEYS) {
    result[key] = skillEffectValue(clamped, caps[key], maxLevel);
  }
  return result;
}

/**
 * Everything a player's skills currently give them.
 *
 * Skills contribute to disjoint effects today, but summing rather than
 * overwriting means a second skill can be pointed at an existing effect later
 * without changing any consumer.
 */
export function getSkillEffects(levels: SkillLevels): ResolvedSkillEffects {
  const total = {} as ResolvedSkillEffects;
  for (const key of EFFECT_KEYS) total[key] = 0;

  for (const skill of SKILLS) {
    const effect = getSkillEffect(skill.id, levels[skill.id] ?? 0);
    for (const key of EFFECT_KEYS) total[key] += effect[key];
  }

  return total;
}

/** A single named effect, for callers that want one number. */
export function getSkillBonus(
  levels: SkillLevels,
  effect: keyof SkillEffectCaps,
): number {
  return getSkillEffects(levels)[effect];
}

/* ------------------------------------------------------------------ *
 * Norwegian descriptions
 * ------------------------------------------------------------------ */

function percent(value: number): string {
  return `${formatPoints(value * 100)} %`;
}

/** How a skill's effect reads at a given level. Null when it does nothing. */
function describe(skillId: SkillId, level: number): string | null {
  if (level <= 0) return null;
  const effect = getSkillEffect(skillId, level);

  switch (skillId) {
    case 'etterretning':
      return (
        `${percent(effect.informationDiscoveryChance)} større sjanse for å finne noe, ` +
        `+${formatPoints(effect.informationReliability)} pålitelighet på det du finner, ` +
        `og ${percent(effect.informationBonusBoost)} mer ut av informasjon du bruker`
      );
    case 'kriminalitet':
      return `+${formatPoints(effect.crimeSuccessPoints)} prosentpoeng sjanse på jobber`;
    case 'motstandskraft':
      return (
        `${percent(effect.damageReduction)} mindre skade og ` +
        `${percent(effect.fineReduction)} mindre tap når en jobb går galt`
      );
    case 'forretning':
      return `${percent(effect.bankFeeReduction)} lavere bankgebyr (ikke i bruk ennå)`;
    case 'mobilitet':
      return `${percent(effect.travelTimeReduction)} raskere forflytning (ikke i bruk ennå)`;
    case 'sosial':
      return `${percent(effect.contactQuality)} bedre kontakter (ikke i bruk ennå)`;
  }
}

export function describeCurrentEffect(skillId: SkillId, level: number): string {
  return describe(skillId, level) ?? 'Ingen effekt ennå.';
}

/** What the next level would give, or null when already at max. */
export function describeNextEffect(skillId: SkillId, level: number): string | null {
  const definition = findSkill(skillId);
  const maxLevel = definition?.maxLevel ?? SKILL_TUNING.maxLevel;
  if (level >= maxLevel) return null;

  return describe(skillId, level + 1);
}
