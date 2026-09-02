/**
 * The city of SKYGGEBY, as data.
 *
 * This is the single source of truth for every district. Nothing anywhere else
 * is allowed to branch on a district id: systems ask this catalogue for a
 * district's ratings and derived modifiers instead. Adding a district means
 * adding one entry here - no core logic changes, no migration.
 *
 * The client reads this to render the map and explain the trade-offs, but the
 * server is the only party that applies it, and it always reads the player's
 * district from the database.
 */

export const DISTRICT_IDS = [
  'sentrum',
  'havna',
  'industrien',
  'neon',
  'blokkene',
  'regjeringskvartalet',
] as const;

export type DistrictId = (typeof DISTRICT_IDS)[number];

/** Where a new player starts. */
export const DEFAULT_DISTRICT_ID: DistrictId = 'sentrum';

/**
 * Ratings are on a 1-5 scale where 3 is the city average. Every gameplay
 * modifier is derived from these three numbers, so a district is described by
 * what it *is*, never by a list of hand-tuned bonuses.
 */
export interface DistrictRatings {
  /** How heavily policed the area is. Raises heat, lowers success. */
  policePresence: number;
  /** How badly things go when they go wrong. Raises fines and injuries. */
  risk: number;
  /** How much is going on. Raises payouts and experience. */
  activity: number;
}

export interface DistrictPosition {
  /** 0-100 within the map viewport, so the frontend can lay the city out. */
  x: number;
  y: number;
}

export interface DistrictDefinition extends DistrictRatings {
  id: DistrictId;
  name: string;
  description: string;
  /** One-line flavour used as a subtitle on the map. */
  tagline: string;
  position: DistrictPosition;
}

export const DISTRICTS: readonly DistrictDefinition[] = [
  {
    id: 'sentrum',
    name: 'Sentrum',
    description:
      'Kontorer, kaffebarer og kameraer i hver eneste lyktestolpe. Det er mye å hente her, men politiet har aldri langt å kjøre.',
    tagline: 'Alle ser deg, ingen kjenner deg',
    policePresence: 4,
    risk: 2,
    activity: 4,
    position: { x: 50, y: 44 },
  },
  {
    id: 'havna',
    name: 'Havna',
    description:
      'Containere, kraner og folk som har lært seg å se en annen vei. Patruljene kommer sjelden hit, men det gjør heller ikke hjelpen.',
    tagline: 'Det som kommer inn, blir sjelden talt',
    policePresence: 2,
    risk: 4,
    activity: 3,
    position: { x: 18, y: 70 },
  },
  {
    id: 'industrien',
    name: 'Industrien',
    description:
      'Lagerhaller, gjerder og vakthold som varierer med hvem som betaler. Skjer det noe her, skjer det bak en port.',
    tagline: 'Støy nok til å overdøve det meste',
    policePresence: 3,
    risk: 4,
    activity: 2,
    position: { x: 26, y: 20 },
  },
  {
    id: 'neon',
    name: 'Neon',
    description:
      'Utesteder, kø på fortauet og penger som skifter hender hele natta. Flest muligheter i byen — og flest vitner.',
    tagline: 'Byen som aldri slukker lyset',
    policePresence: 3,
    risk: 3,
    activity: 5,
    position: { x: 76, y: 24 },
  },
  {
    id: 'blokkene',
    name: 'Blokkene',
    description:
      'Høyblokker, bakganger og en dyp uvilje mot å snakke med uniformer. Politiet kjører gjennom, sjelden inn.',
    tagline: 'Her løser folk ting selv',
    policePresence: 1,
    risk: 3,
    activity: 3,
    position: { x: 80, y: 72 },
  },
  {
    id: 'regjeringskvartalet',
    name: 'Regjeringskvartalet',
    description:
      'Sperringer, adgangskort og sivile biler som står litt for lenge. Byens best voktede kvartal — og det dyreste å bomme i.',
    tagline: 'Alt registreres, ingenting glemmes',
    policePresence: 5,
    risk: 5,
    activity: 2,
    position: { x: 50, y: 8 },
  },
];

const DISTRICT_BY_ID = new Map<string, DistrictDefinition>(
  DISTRICTS.map((district) => [district.id, district]),
);

export function findDistrict(id: string): DistrictDefinition | undefined {
  return DISTRICT_BY_ID.get(id);
}

export function isDistrictId(id: string): id is DistrictId {
  return DISTRICT_BY_ID.has(id);
}

/**
 * Resolves a district, falling back to the default. Used where a missing or
 * unknown id must never break the game - a stored id that no longer exists in
 * the catalogue should degrade to Sentrum, not throw.
 */
export function resolveDistrict(id: string | null | undefined): DistrictDefinition {
  return (id ? DISTRICT_BY_ID.get(id) : undefined) ?? DISTRICT_BY_ID.get(DEFAULT_DISTRICT_ID)!;
}

/* ------------------------------------------------------------------ *
 * Modifiers
 * ------------------------------------------------------------------ */

/**
 * How strongly each rating pulls its modifier, per step away from the city
 * average of 3. Tuning the whole city happens here and nowhere else.
 */
export const DISTRICT_WEIGHTS = {
  /** Police presence vs. the chance of pulling a job off. */
  successPerPolice: 0.06,
  /** Police presence vs. how much attention a job attracts. */
  heatPerPolice: 0.2,
  /** Activity vs. how much there is to take. */
  payoutPerActivity: 0.1,
  /** Activity vs. how much you learn. */
  xpPerActivity: 0.05,
  /** Risk vs. what a failure costs in cash. */
  finePerRisk: 0.25,
  /** Risk vs. what a failure costs in health. */
  healthLossPerRisk: 0.15,
} as const;

/** The average rating a modifier is measured against. */
const BASELINE = 3;

export interface DistrictModifiers {
  /** Multiplies the effective success chance. */
  success: number;
  /** Multiplies heat gained. */
  heat: number;
  /** Multiplies cash payouts. */
  payout: number;
  /** Multiplies experience earned. */
  xp: number;
  /** Multiplies cash lost on failure. */
  fine: number;
  /** Multiplies health lost on failure. */
  healthLoss: number;
}

/**
 * Derives every gameplay modifier from a district's three ratings.
 *
 * Deriving rather than listing means a new district cannot accidentally ship
 * with an inconsistent set of bonuses, and rebalancing the city is a change to
 * `DISTRICT_WEIGHTS` alone.
 */
export function districtModifiers(district: DistrictRatings): DistrictModifiers {
  const police = district.policePresence - BASELINE;
  const risk = district.risk - BASELINE;
  const activity = district.activity - BASELINE;

  return {
    success: 1 - police * DISTRICT_WEIGHTS.successPerPolice,
    heat: 1 + police * DISTRICT_WEIGHTS.heatPerPolice,
    payout: 1 + activity * DISTRICT_WEIGHTS.payoutPerActivity,
    xp: 1 + activity * DISTRICT_WEIGHTS.xpPerActivity,
    fine: 1 + risk * DISTRICT_WEIGHTS.finePerRisk,
    healthLoss: 1 + risk * DISTRICT_WEIGHTS.healthLossPerRisk,
  };
}

/* ------------------------------------------------------------------ *
 * Norwegian presentation helpers
 * ------------------------------------------------------------------ */

const RATING_SCALE = ['Ingen', 'Svært lav', 'Lav', 'Moderat', 'Høy', 'Svært høy'] as const;

/** Turns a 1-5 rating into Norwegian text. */
export function ratingLabel(rating: number): string {
  const index = Math.max(0, Math.min(RATING_SCALE.length - 1, Math.round(rating)));
  return RATING_SCALE[index] ?? 'Ukjent';
}

export function policeLabel(rating: number): string {
  return ratingLabel(rating);
}

export function activityLabel(rating: number): string {
  return ratingLabel(rating);
}

export function districtRiskLabel(rating: number): string {
  return ratingLabel(rating);
}

/** Renders a multiplier as a signed Norwegian percentage, e.g. "+20 %". */
export function modifierPercent(multiplier: number): string {
  const delta = Math.round((multiplier - 1) * 100);
  if (delta === 0) return '0 %';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} %`;
}

/**
 * Short Norwegian summary of what a district does to your work, for the UI.
 * Only the modifiers that actually differ from average are listed.
 */
export function describeModifiers(district: DistrictRatings): string[] {
  const mods = districtModifiers(district);
  const lines: string[] = [];

  if (mods.success !== 1) lines.push(`${modifierPercent(mods.success)} sjanse`);
  if (mods.payout !== 1) lines.push(`${modifierPercent(mods.payout)} utbytte`);
  if (mods.xp !== 1) lines.push(`${modifierPercent(mods.xp)} XP`);
  if (mods.heat !== 1) lines.push(`${modifierPercent(mods.heat)} heat`);
  if (mods.fine !== 1) lines.push(`${modifierPercent(mods.fine)} tap ved tabbe`);
  if (mods.healthLoss !== 1) lines.push(`${modifierPercent(mods.healthLoss)} skade`);

  return lines;
}
