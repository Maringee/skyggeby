import { SKILLS, type SkillId } from '@skyggeby/shared';

/**
 * What each skill is actually worth at maximum level.
 *
 * These ceilings are the whole balance of the skill system. They live on the
 * server because they are gameplay authority, not presentation: the client is
 * told the resulting numbers, never the table that produced them.
 *
 * Every value is a hard cap reached only at level 25, approached along the
 * shared diminishing-returns curve.
 */
export interface SkillEffectCaps {
  /** Extra chance of an exploration turning up anything, as a fraction. */
  informationDiscoveryChance: number;
  /** Extra points added to a discovered piece of information's reliability. */
  informationReliability: number;
  /**
   * How much the crime bonus from information is amplified, as a fraction.
   * The information system's own +15 point ceiling still applies afterwards.
   */
  informationBonusBoost: number;
  /** Extra percentage points on a crime's success chance. */
  crimeSuccessPoints: number;
  /** Share of health loss avoided when a job goes wrong, 0..1. */
  damageReduction: number;
  /** Share of the cash penalty avoided when a job goes wrong, 0..1. */
  fineReduction: number;

  /* Dormant: computed and exposed, but nothing consumes them yet. */
  /** Share of bank fees waived, 0..1. */
  bankFeeReduction: number;
  /** Share of future travel time saved, 0..1. */
  travelTimeReduction: number;
  /** Quality bonus for future contacts and deals, 0..1. */
  contactQuality: number;
}

const NONE: SkillEffectCaps = {
  informationDiscoveryChance: 0,
  informationReliability: 0,
  informationBonusBoost: 0,
  crimeSuccessPoints: 0,
  damageReduction: 0,
  fineReduction: 0,
  bankFeeReduction: 0,
  travelTimeReduction: 0,
  contactQuality: 0,
};

export const SKILL_EFFECT_CAPS: Record<SkillId, SkillEffectCaps> = {
  etterretning: {
    ...NONE,
    informationDiscoveryChance: 0.12,
    informationReliability: 8,
    informationBonusBoost: 0.35,
  },
  kriminalitet: {
    ...NONE,
    crimeSuccessPoints: 6,
  },
  motstandskraft: {
    ...NONE,
    damageReduction: 0.25,
    fineReduction: 0.2,
  },
  forretning: {
    ...NONE,
    bankFeeReduction: 0.3,
  },
  mobilitet: {
    ...NONE,
    travelTimeReduction: 0.4,
  },
  sosial: {
    ...NONE,
    contactQuality: 0.3,
  },
};

export const EFFECT_KEYS = Object.keys(NONE) as Array<keyof SkillEffectCaps>;

export { SKILLS };
