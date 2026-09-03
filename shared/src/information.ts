/**
 * Information — knowledge about the city that a player can discover, weigh,
 * use or ignore.
 *
 * This file owns every constant the system is balanced on, plus the pure maths
 * for freshness, value and the crime bonus. The client imports it to render and
 * explain what the player holds; the server is the only party that ever writes
 * a value or applies a bonus, and the internal truth flag never leaves it.
 */

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const INFORMATION_TYPES = [
  'RYKTE',
  'OBSERVASJON',
  'ETTERRETNING',
  'KONTAKT',
  'HEMMELIGHET',
] as const;
export type InformationType = (typeof INFORMATION_TYPES)[number];

export const INFORMATION_SOURCES = [
  'UKJENT',
  'OBSERVASJON',
  'KONTAKT',
  'ETTERFORSKNING',
  'HENDELSE',
] as const;
export type InformationSource = (typeof INFORMATION_SOURCES)[number];

/**
 * What a piece of information is *about*. Gating the crime bonus on this is
 * what stops every tip from helping with every job. New categories can be
 * appended without touching the systems that consume them.
 */
export const INFORMATION_RELEVANCE = [
  'POLITI',
  'AKTIVITET',
  'SIKKERHET',
  'LAGER',
  'TRANSPORT',
  'MULIGHET',
] as const;
export type InformationRelevance = (typeof INFORMATION_RELEVANCE)[number];

export const FRESHNESS_LEVELS = ['FERSK', 'GAMMEL', 'UTDATERT', 'UTBRUKT'] as const;
export type Freshness = (typeof FRESHNESS_LEVELS)[number];

/* ------------------------------------------------------------------ *
 * Norwegian labels
 * ------------------------------------------------------------------ */

export const INFORMATION_TYPE_LABELS: Record<InformationType, string> = {
  RYKTE: 'Rykte',
  OBSERVASJON: 'Observasjon',
  ETTERRETNING: 'Etterretning',
  KONTAKT: 'Kontakt',
  HEMMELIGHET: 'Hemmelighet',
};

export const INFORMATION_TYPE_DESCRIPTIONS: Record<InformationType, string> = {
  RYKTE: 'Noe noen sa. Lett å komme over, vanskelig å stole på.',
  OBSERVASJON: 'Noe som faktisk ble sett, på et sted, på et tidspunkt.',
  ETTERRETNING: 'Bearbeidet og etterprøvd. Det nærmeste du kommer sikkert.',
  KONTAKT: 'Kom fra noen som ville du skulle vite det. Spørsmålet er hvorfor.',
  HEMMELIGHET: 'Noe få vet. Verdt mye — hvis det stemmer.',
};

export const INFORMATION_SOURCE_LABELS: Record<InformationSource, string> = {
  UKJENT: 'Ukjent',
  OBSERVASJON: 'Egen observasjon',
  KONTAKT: 'Kontakt',
  ETTERFORSKNING: 'Etterforskning',
  HENDELSE: 'Hendelse',
};

export const INFORMATION_RELEVANCE_LABELS: Record<InformationRelevance, string> = {
  POLITI: 'Politi',
  AKTIVITET: 'Aktivitet',
  SIKKERHET: 'Sikkerhet',
  LAGER: 'Lager',
  TRANSPORT: 'Transport',
  MULIGHET: 'Mulighet',
};

export const FRESHNESS_LABELS: Record<Freshness, string> = {
  FERSK: 'Fersk',
  GAMMEL: 'Gammel',
  UTDATERT: 'Utdatert',
  UTBRUKT: 'Utbrukt',
};

export const FRESHNESS_DESCRIPTIONS: Record<Freshness, string> = {
  FERSK: 'Fortsatt til å stole på.',
  GAMMEL: 'Begynner å bli gammel. Mindre å hente.',
  UTDATERT: 'Gått ut på dato. Gir ingen fordel lenger.',
  UTBRUKT: 'Allerede brukt. Kan ikke brukes igjen.',
};

/* ------------------------------------------------------------------ *
 * Balance
 * ------------------------------------------------------------------ */

export interface InformationTypeBalance {
  /** Relative chance of a discovery being of this type. */
  weight: number;
  /** Range the stated reliability is drawn from. */
  reliability: { min: number; max: number };
  /** How long the information stays relevant, in minutes. */
  lifetimeMinutes: number;
  /** Base worth before reliability and district are taken into account. */
  value: number;
  /** How much of the maximum crime bonus this type can carry, 0..1. */
  bonusWeight: number;
  /** Default source when a discovery of this type is generated. */
  defaultSource: InformationSource;
}

export const INFORMATION_BALANCE: Record<InformationType, InformationTypeBalance> = {
  RYKTE: {
    weight: 45,
    reliability: { min: 25, max: 60 },
    lifetimeMinutes: 90,
    value: 120,
    bonusWeight: 0.5,
    defaultSource: 'UKJENT',
  },
  OBSERVASJON: {
    weight: 30,
    reliability: { min: 55, max: 85 },
    lifetimeMinutes: 180,
    value: 260,
    bonusWeight: 0.75,
    defaultSource: 'OBSERVASJON',
  },
  KONTAKT: {
    weight: 13,
    reliability: { min: 45, max: 80 },
    lifetimeMinutes: 240,
    value: 340,
    bonusWeight: 0.8,
    defaultSource: 'KONTAKT',
  },
  ETTERRETNING: {
    weight: 9,
    reliability: { min: 75, max: 95 },
    lifetimeMinutes: 360,
    value: 520,
    bonusWeight: 1,
    defaultSource: 'ETTERFORSKNING',
  },
  HEMMELIGHET: {
    weight: 3,
    reliability: { min: 40, max: 90 },
    lifetimeMinutes: 720,
    value: 1400,
    bonusWeight: 1,
    defaultSource: 'HENDELSE',
  },
};

export const INFORMATION_TUNING = {
  /** Reliability is always stored inside this range. */
  minReliability: 0,
  maxReliability: 100,

  /**
   * Hard ceiling on how much information can move a success chance, in
   * percentage points. Nothing in the system may exceed this: information is
   * meant to be useful, never enough on its own to make a dangerous job safe.
   */
  maxBonusPercentagePoints: 15,

  /** Energy an exploration costs. */
  exploreEnergyCost: 3,
  /** Experience for going out and looking, found something or not. */
  exploreXp: 6,
  /** Seconds before the player may explore again. */
  exploreCooldownSeconds: 120,
  /** Base chance of finding anything at all, before district activity. */
  exploreBaseChance: 0.55,
  /** How much each step of district activity above average helps. */
  exploreChancePerActivity: 0.06,
  /** Bounds on the discovery chance after modifiers. */
  exploreMinChance: 0.2,
  exploreMaxChance: 0.85,

  /**
   * How stated reliability maps to the odds the information is actually true.
   * Even a very reliable-looking tip can be wrong, and a shaky one can be right.
   */
  truthFloor: 0.35,
  truthSpan: 0.6,

  /** Fraction of its lifetime before information stops being FERSK. */
  freshThreshold: 0.35,
} as const;

/** How much of its bonus information retains as it ages. */
export const FRESHNESS_BONUS_FACTOR: Record<Freshness, number> = {
  FERSK: 1,
  GAMMEL: 0.55,
  UTDATERT: 0,
  UTBRUKT: 0,
};

/** How much of its worth information retains as it ages. */
export const FRESHNESS_VALUE_FACTOR: Record<Freshness, number> = {
  FERSK: 1,
  GAMMEL: 0.7,
  UTDATERT: 0.3,
  UTBRUKT: 0.1,
};

/* ------------------------------------------------------------------ *
 * Freshness
 * ------------------------------------------------------------------ */

export interface FreshnessInput {
  discoveredAt: Date;
  expiresAt: Date | null;
  usedAt: Date | null;
}

/**
 * Where a piece of information sits in its life. Derived purely from
 * timestamps, so the client can render it live and the server can trust it.
 */
export function resolveFreshness(input: FreshnessInput, now: Date = new Date()): Freshness {
  if (input.usedAt) return 'UTBRUKT';
  if (!input.expiresAt) return 'FERSK';

  const nowMs = now.getTime();
  if (nowMs >= input.expiresAt.getTime()) return 'UTDATERT';

  const lifetime = input.expiresAt.getTime() - input.discoveredAt.getTime();
  if (lifetime <= 0) return 'UTDATERT';

  const elapsed = nowMs - input.discoveredAt.getTime();
  return elapsed / lifetime < INFORMATION_TUNING.freshThreshold ? 'FERSK' : 'GAMMEL';
}

/** Seconds until the information expires, or null when it never does. */
export function secondsUntilExpiry(expiresAt: Date | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

/* ------------------------------------------------------------------ *
 * Value
 * ------------------------------------------------------------------ */

export interface ValueInput {
  type: InformationType;
  reliability: number;
  /** District activity 1-5, or null for city-wide information. */
  districtActivity: number | null;
}

/**
 * What the information is potentially worth. Not a market price - there is no
 * market yet - but the server's single measure of worth, so a later market has
 * one number to build on.
 */
export function computeBaseValue(input: ValueInput): number {
  const balance = INFORMATION_BALANCE[input.type];
  const reliability = clampReliability(input.reliability);

  // Reliability moves worth between half and full.
  const confidence = 0.5 + reliability / 200;
  const activity = input.districtActivity === null ? 1 : 0.9 + input.districtActivity * 0.05;

  return Math.max(1, Math.round(balance.value * confidence * activity));
}

/** What the information is worth right now, after ageing. */
export function currentValue(baseValue: number, freshness: Freshness): number {
  return Math.max(0, Math.round(baseValue * FRESHNESS_VALUE_FACTOR[freshness]));
}

export function clampReliability(value: number): number {
  return Math.round(
    Math.min(
      INFORMATION_TUNING.maxReliability,
      Math.max(INFORMATION_TUNING.minReliability, value),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Crime bonus
 * ------------------------------------------------------------------ */

export interface BonusInput {
  type: InformationType;
  reliability: number;
  freshness: Freshness;
}

/**
 * How many percentage points this information adds to a success chance.
 *
 * The only place the bonus is calculated. Bounded by
 * `maxBonusPercentagePoints` at both ends of the maths, so no combination of
 * inputs - however manipulated - can exceed the ceiling.
 */
export function informationBonusPoints(input: BonusInput): number {
  const balance = INFORMATION_BALANCE[input.type];
  const reliability = clampReliability(input.reliability) / 100;
  const freshness = FRESHNESS_BONUS_FACTOR[input.freshness] ?? 0;

  const raw =
    INFORMATION_TUNING.maxBonusPercentagePoints *
    balance.bonusWeight *
    reliability *
    freshness;

  return Math.max(
    0,
    Math.min(INFORMATION_TUNING.maxBonusPercentagePoints, Math.round(raw * 10) / 10),
  );
}

/** The same bonus expressed as a fraction, ready to add to a 0..1 chance. */
export function informationBonusFraction(input: BonusInput): number {
  return informationBonusPoints(input) / 100;
}

/* ------------------------------------------------------------------ *
 * Relevance
 * ------------------------------------------------------------------ */

/**
 * Which kinds of knowledge actually help with which job.
 *
 * `MULIGHET` is deliberately absent here and treated as universal: an opening
 * is an opening whatever you were planning.
 */
export const CRIME_RELEVANCE: Record<string, readonly InformationRelevance[]> = {
  lommetyveri: ['AKTIVITET', 'POLITI'],
  butikktyveri: ['SIKKERHET', 'AKTIVITET'],
  innbrudd: ['SIKKERHET', 'POLITI'],
  bilkapring: ['TRANSPORT', 'SIKKERHET'],
  lagerinnbrudd: ['LAGER', 'SIKKERHET', 'TRANSPORT'],
};

/** Relevance categories that help with every job. */
export const UNIVERSAL_RELEVANCE: readonly InformationRelevance[] = ['MULIGHET'];

export function relevanceForCrime(crimeId: string): readonly InformationRelevance[] {
  return [...(CRIME_RELEVANCE[crimeId] ?? []), ...UNIVERSAL_RELEVANCE];
}

export function isRelevantToCrime(
  relevance: InformationRelevance,
  crimeId: string,
): boolean {
  return relevanceForCrime(crimeId).includes(relevance);
}

/** Norwegian list of the jobs a piece of information could help with. */
export function crimesHelpedBy(relevance: InformationRelevance): string[] {
  if (UNIVERSAL_RELEVANCE.includes(relevance)) return ['Alle jobber'];
  return Object.entries(CRIME_RELEVANCE)
    .filter(([, list]) => list.includes(relevance))
    .map(([crimeId]) => crimeId);
}
