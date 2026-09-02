/**
 * Skills — permanent specialisation, separate from XP.
 *
 * XP remains the single source of truth for player level. Skills are a second,
 * independent axis: levelling up grants skill points, and the player spends
 * them where they want to specialise.
 *
 * This file owns the catalogue, the point curve and the shape of the
 * diminishing-returns curve. Translating a skill level into an actual gameplay
 * number happens in exactly one place on the server
 * (`server/src/modules/skills/skill.effects.ts`) — never here, and never in the
 * client.
 */

export const SKILL_IDS = [
  'etterretning',
  'kriminalitet',
  'forretning',
  'mobilitet',
  'sosial',
  'motstandskraft',
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

/** Loose grouping, kept for a later skill overview. No gameplay meaning yet. */
export const SKILL_CATEGORIES = ['KUNNSKAP', 'HANDVERK', 'PERSON'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export interface SkillDefinition {
  id: SkillId;
  name: string;
  description: string;
  /** One line on what specialising here is for. */
  focus: string;
  category: SkillCategory;
  maxLevel: number;
  /** True when nothing consumes the skill's effect yet. */
  dormant: boolean;
}

export const SKILL_TUNING = {
  /** Ceiling for every skill in v1. */
  maxLevel: 25,

  /**
   * Shape of the diminishing-returns curve. Each level adds this fraction of
   * the *remaining* effect, so early levels move the needle most and late ones
   * still help without ever running away.
   */
  curveDecay: 0.9,

  /** Points granted per level gained, by band. */
  pointsPerLevelEarly: 2,
  pointsPerLevelLate: 1,
  /** Last level that grants the early rate. */
  earlyBandEnd: 10,
  /** Last level that grants anything at all in v1. */
  lateBandEnd: 20,

  /** One upgrade costs this many points. */
  upgradeCost: 1,
} as const;

export const SKILLS: readonly SkillDefinition[] = [
  {
    id: 'etterretning',
    name: 'Etterretning',
    description:
      'Du vet hvor du skal lete, og du kjenner igjen et tips som holder vann.',
    focus: 'Finner mer og bedre informasjon.',
    category: 'KUNNSKAP',
    maxLevel: SKILL_TUNING.maxLevel,
    dormant: false,
  },
  {
    id: 'kriminalitet',
    name: 'Kriminalitet',
    description:
      'Håndverket. Rolige hender, riktig verktøy og en plan for når det går galt.',
    focus: 'Bedre odds på jobber.',
    category: 'HANDVERK',
    maxLevel: SKILL_TUNING.maxLevel,
    dormant: false,
  },
  {
    id: 'forretning',
    name: 'Forretning',
    description:
      'Du forstår tall, marginer og hvem som tar seg betalt for hva.',
    focus: 'Bedre betingelser i økonomien.',
    category: 'KUNNSKAP',
    maxLevel: SKILL_TUNING.maxLevel,
    dormant: true,
  },
  {
    id: 'mobilitet',
    name: 'Mobilitet',
    description:
      'Du kommer deg dit du skal, og vekk igjen, uten å bli lagt merke til.',
    focus: 'Raskere og tryggere forflytning.',
    category: 'HANDVERK',
    maxLevel: SKILL_TUNING.maxLevel,
    dormant: true,
  },
  {
    id: 'sosial',
    name: 'Sosial',
    description:
      'Folk snakker med deg. Noen ganger sier de mer enn de hadde tenkt.',
    focus: 'Bedre kontakter og avtaler.',
    category: 'PERSON',
    maxLevel: SKILL_TUNING.maxLevel,
    dormant: true,
  },
  {
    id: 'motstandskraft',
    name: 'Motstandskraft',
    description:
      'Du tåler en trøkk, og du gjør færre dumme ting når det brenner.',
    focus: 'Mindre skade når noe går galt.',
    category: 'PERSON',
    maxLevel: SKILL_TUNING.maxLevel,
    dormant: false,
  },
];

const SKILL_BY_ID = new Map<string, SkillDefinition>(
  SKILLS.map((skill) => [skill.id, skill]),
);

export function findSkill(id: string): SkillDefinition | undefined {
  return SKILL_BY_ID.get(id);
}

export function isSkillId(id: string): id is SkillId {
  return SKILL_BY_ID.has(id);
}

/* ------------------------------------------------------------------ *
 * Skill points
 * ------------------------------------------------------------------ */

/**
 * Total skill points a player at this level should ever have been granted.
 *
 * Expressed as a total rather than a per-level award so that multi-level jumps,
 * and the baseline for accounts that existed before skills, both fall out of
 * the same function instead of being special cases.
 *
 *   level 1        0   (you start here, nothing granted)
 *   levels 2-10   +2 each  -> 18 at level 10
 *   levels 11-20  +1 each  -> 28 at level 20
 *   levels 21+     0       -> stays 28 in v1
 */
export function totalSkillPointsForLevel(level: number): number {
  const capped = Math.max(1, Math.floor(level));

  if (capped <= 1) return 0;

  const early =
    Math.min(capped, SKILL_TUNING.earlyBandEnd) - 1;
  let total = early * SKILL_TUNING.pointsPerLevelEarly;

  if (capped > SKILL_TUNING.earlyBandEnd) {
    const late =
      Math.min(capped, SKILL_TUNING.lateBandEnd) - SKILL_TUNING.earlyBandEnd;
    total += late * SKILL_TUNING.pointsPerLevelLate;
  }

  return total;
}

/** Points granted for moving from one level to another. Never negative. */
export function skillPointsForLevelUp(fromLevel: number, toLevel: number): number {
  return Math.max(
    0,
    totalSkillPointsForLevel(toLevel) - totalSkillPointsForLevel(fromLevel),
  );
}

/* ------------------------------------------------------------------ *
 * The curve
 * ------------------------------------------------------------------ */

/**
 * How much of a skill's maximum effect is unlocked at a given level, 0..1.
 *
 * Deliberately not linear. Each level adds a share of what is left, so the
 * first point is worth clearly more than the twenty-fifth, and no skill can
 * scale into something that trivialises the game.
 *
 *   level 0  -> 0
 *   level 1  -> ~0.11
 *   level 5  -> ~0.44
 *   level 13 -> ~0.80
 *   level 25 -> 1
 */
export function skillCurve(level: number, maxLevel: number = SKILL_TUNING.maxLevel): number {
  const clamped = Math.max(0, Math.min(maxLevel, Math.floor(level)));
  if (clamped <= 0) return 0;
  if (clamped >= maxLevel) return 1;

  const decay = SKILL_TUNING.curveDecay;
  return (1 - Math.pow(decay, clamped)) / (1 - Math.pow(decay, maxLevel));
}

/**
 * Scales a maximum effect along the curve.
 *
 * Every gameplay effect in the game goes through this, which is what makes the
 * hard ceiling on each effect actually hard: the result can never exceed `max`.
 */
export function skillEffectValue(
  level: number,
  max: number,
  maxLevel: number = SKILL_TUNING.maxLevel,
): number {
  return max * skillCurve(level, maxLevel);
}

export function clampSkillLevel(
  level: number,
  maxLevel: number = SKILL_TUNING.maxLevel,
): number {
  return Math.max(0, Math.min(maxLevel, Math.floor(level)));
}
