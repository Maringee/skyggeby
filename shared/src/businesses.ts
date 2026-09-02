/**
 * Businesses — things a player owns *and runs*.
 *
 * The catalogue lives here alongside districts, crimes, assets and contacts, so
 * adding a business type is one entry and no migration. Price, district, income
 * and cost are all read from this file by the server; a client never sends a
 * number that becomes money.
 *
 * An asset is something you own. A business is something you own that produces
 * economic activity over time: it earns, it costs to run, and the difference
 * accumulates on its own balance until the player takes it out.
 *
 * v1 is deliberately narrow. Condition, activity and risk are stored and shown
 * but change nothing yet, and no other system - skills, contacts, information,
 * districts - touches the rates. They are foundations, not gameplay.
 */

import { DISTRICT_IDS, type DistrictId } from './districts';

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

/**
 * How many whole days of income a business can hold before it stops
 * accumulating. A player who disappears for a month comes back to seven days'
 * worth, not thirty. Defined once; nothing else is allowed to hardcode it.
 */
export const MAX_SETTLEMENT_DAYS = 7;

export const SECONDS_PER_DAY = 24 * 60 * 60;
const MS_PER_DAY = SECONDS_PER_DAY * 1000;

export const BUSINESS_TUNING = {
  /** Hard ceiling on how many businesses one player can own. */
  maxBusinesses: 3,
  maxSettlementDays: MAX_SETTLEMENT_DAYS,
  /** Player-chosen name, after trimming. */
  minNameLength: 3,
  maxNameLength: 32,
  minCondition: 0,
  maxCondition: 100,
  minActivity: 0,
  maxActivity: 100,
  minRisk: 1,
  maxRisk: 5,
} as const;

/* ------------------------------------------------------------------ *
 * Catalogue
 * ------------------------------------------------------------------ */

export interface BusinessTypeDefinition {
  /** Stable id. Never regenerated - owned rows point at it. */
  id: string;
  name: string;
  /** Norwegian flavour, one or two sentences. */
  description: string;
  /** Where the business sits. The player never chooses this. */
  districtId: DistrictId;
  purchasePrice: number;
  /** Gross kroner per day. */
  incomePerDay: number;
  /** Kroner per day it costs to keep running. */
  operatingCostPerDay: number;
  /** 1-5. Shown, but wired to nothing in v1. */
  risk: number;
  /** 0-100. Shown, but wired to nothing in v1. */
  activity: number;
  /** 0-100. What a freshly bought business starts at. */
  condition: number;
}

export const BUSINESS_TYPES: readonly BusinessTypeDefinition[] = [
  {
    id: 'naerbutikk',
    name: 'Nærbutikk',
    description:
      'Åpent til sent, tomme hyller innerst og en kasse som teller mer enn den selger.',
    districtId: 'blokkene',
    purchasePrice: 200000,
    incomePerDay: 2000,
    operatingCostPerDay: 750,
    risk: 1,
    activity: 50,
    condition: 100,
  },
  {
    id: 'verksted',
    name: 'Verksted',
    description:
      'Olje i betongen og biler som kommer inn med én historie og ut med en annen.',
    districtId: 'havna',
    purchasePrice: 350000,
    incomePerDay: 3500,
    operatingCostPerDay: 1500,
    risk: 2,
    activity: 55,
    condition: 100,
  },
  {
    id: 'drosjesentral',
    name: 'Drosjesentral',
    description: 'Biler i bevegelse hele døgnet. Ingen legger merke til én tur ekstra.',
    districtId: 'sentrum',
    purchasePrice: 500000,
    incomePerDay: 5000,
    operatingCostPerDay: 2250,
    risk: 2,
    activity: 60,
    condition: 100,
  },
  {
    id: 'nattklubb',
    name: 'Nattklubb',
    description:
      'Kø ute, mørkt inne og kontanter som skifter hender raskere enn noen rekker å telle.',
    districtId: 'neon',
    purchasePrice: 750000,
    incomePerDay: 9000,
    operatingCostPerDay: 4000,
    risk: 3,
    activity: 70,
    condition: 100,
  },
  {
    id: 'lagerfirma',
    name: 'Lagerfirma',
    description: 'Haller, paller og papirer. Det viktigste er at alt ser ut som det skal.',
    districtId: 'industrien',
    purchasePrice: 900000,
    incomePerDay: 7500,
    operatingCostPerDay: 2500,
    risk: 3,
    activity: 60,
    condition: 100,
  },
  {
    id: 'konsulentselskap',
    name: 'Konsulentselskap',
    description:
      'Fem ansatte, tolv fakturaer og et navn ingen husker. Nøyaktig som planlagt.',
    districtId: 'regjeringskvartalet',
    purchasePrice: 1500000,
    incomePerDay: 13000,
    operatingCostPerDay: 5000,
    risk: 4,
    activity: 65,
    condition: 100,
  },
];

const BUSINESS_BY_ID = new Map<string, BusinessTypeDefinition>(
  BUSINESS_TYPES.map((business) => [business.id, business]),
);

export function findBusinessType(id: string): BusinessTypeDefinition | undefined {
  return BUSINESS_BY_ID.get(id);
}

export function isBusinessTypeId(id: string): boolean {
  return BUSINESS_BY_ID.has(id);
}

export const BUSINESS_TYPE_IDS: readonly string[] = BUSINESS_TYPES.map((b) => b.id);

/* ------------------------------------------------------------------ *
 * Rates and value
 * ------------------------------------------------------------------ */

export interface BusinessRates {
  incomePerDay: number;
  operatingCostPerDay: number;
}

/** What the business actually leaves behind per day, after running costs. */
export function netIncomePerDay(rates: BusinessRates): number {
  return rates.incomePerDay - rates.operatingCostPerDay;
}

export function clampBusinessCondition(condition: number): number {
  return Math.round(
    Math.min(
      BUSINESS_TUNING.maxCondition,
      Math.max(BUSINESS_TUNING.minCondition, condition),
    ),
  );
}

/**
 * Display estimate of what a business is worth.
 *
 * Deliberately not the balance on its account: money waiting to be collected is
 * not part of what the business itself is worth. v1 uses this for the overview
 * only - nothing sells a business yet.
 */
export function calculateBusinessValue(purchasePrice: number, condition: number): number {
  const factor = clampBusinessCondition(condition) / 100;
  return Math.max(0, Math.floor(purchasePrice * factor));
}

/** Norwegian label for a risk rating, 1-5. */
export function businessRiskLabel(risk: number): string {
  if (risk >= 5) return 'Svært høy';
  if (risk >= 4) return 'Høy';
  if (risk >= 3) return 'Forhøyet';
  if (risk >= 2) return 'Middels';
  return 'Lav';
}

/* ------------------------------------------------------------------ *
 * Settlement
 * ------------------------------------------------------------------ */

export interface SettlementInput extends BusinessRates {
  /** When earnings were last credited to the business account. */
  lastSettlementAt: Date;
}

export interface BusinessSettlement {
  /** Real time since the last settlement. */
  elapsedMs: number;
  /** Time actually paid for, never more than the cap. */
  settledMs: number;
  /** True when time was thrown away because the cap was reached. */
  capped: boolean;
  /** Whole kroner to add to the business account. Never negative. */
  net: number;
  /**
   * Where `lastSettlementAt` should move to.
   *
   * Not simply "now": a partial krone must survive, or a player who refreshes
   * every thirty seconds would round away every øre and never earn anything.
   * Only the time actually paid for is consumed - except when the cap struck,
   * where the surplus is deliberately dropped.
   */
  nextSettlementAt: Date;
}

/**
 * Works out what a business has earned since it was last settled.
 *
 * The rate is net: income minus running cost, spread evenly across the day and
 * rounded down to whole kroner. Twelve hours of a 5 000 kr/day business is
 * 2 500 kr; thirty-six hours is 7 500 kr.
 *
 * Nothing here writes anything. The caller decides, under a row lock, whether
 * to apply the result - which is what makes double settlement impossible.
 */
export function calculateBusinessSettlement(
  input: SettlementInput,
  now: Date = new Date(),
): BusinessSettlement {
  const perDay = netIncomePerDay(input);
  const elapsedMs = Math.max(0, now.getTime() - input.lastSettlementAt.getTime());
  const capMs = MAX_SETTLEMENT_DAYS * MS_PER_DAY;
  const capped = elapsedMs > capMs;
  const settledMs = capped ? capMs : elapsedMs;

  if (perDay <= 0 || settledMs <= 0) {
    return {
      elapsedMs,
      settledMs,
      capped,
      net: 0,
      // A capped business still moves forward, or it would sit at the ceiling
      // recomputing the same discarded surplus on every request.
      nextSettlementAt: capped ? now : input.lastSettlementAt,
    };
  }

  const net = Math.floor((settledMs * perDay) / MS_PER_DAY);

  if (capped) {
    return { elapsedMs, settledMs, capped, net, nextSettlementAt: now };
  }

  // Consume exactly the time those kroner paid for, and leave the remainder.
  const consumedMs = Math.floor((net * MS_PER_DAY) / perDay);

  return {
    elapsedMs,
    settledMs,
    capped,
    net,
    nextSettlementAt:
      net > 0
        ? new Date(input.lastSettlementAt.getTime() + consumedMs)
        : input.lastSettlementAt,
  };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * Checks the catalogue against its own rules. Run from the tests, so a bad
 * entry fails the suite rather than reaching a player.
 */
export function validateBusinessCatalogue(): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const business of BUSINESS_TYPES) {
    if (seenIds.has(business.id)) problems.push(`Duplikat id: ${business.id}`);
    seenIds.add(business.id);

    if (seenNames.has(business.name)) problems.push(`Duplikat navn: ${business.name}`);
    seenNames.add(business.name);

    if (!(DISTRICT_IDS as readonly string[]).includes(business.districtId)) {
      problems.push(`${business.id}: ukjent distrikt ${business.districtId}`);
    }
    if (!Number.isInteger(business.purchasePrice) || business.purchasePrice <= 0) {
      problems.push(`${business.id}: ugyldig kjøpspris`);
    }
    if (!Number.isInteger(business.incomePerDay) || business.incomePerDay < 0) {
      problems.push(`${business.id}: ugyldig inntekt`);
    }
    if (
      !Number.isInteger(business.operatingCostPerDay) ||
      business.operatingCostPerDay < 0
    ) {
      problems.push(`${business.id}: ugyldig driftskostnad`);
    }
    if (business.incomePerDay < business.operatingCostPerDay) {
      problems.push(`${business.id}: driften går med underskudd`);
    }
    if (
      business.risk < BUSINESS_TUNING.minRisk ||
      business.risk > BUSINESS_TUNING.maxRisk
    ) {
      problems.push(`${business.id}: risiko utenfor 1-5`);
    }
    if (
      business.activity < BUSINESS_TUNING.minActivity ||
      business.activity > BUSINESS_TUNING.maxActivity
    ) {
      problems.push(`${business.id}: aktivitet utenfor 0-100`);
    }
    if (
      business.condition < BUSINESS_TUNING.minCondition ||
      business.condition > BUSINESS_TUNING.maxCondition
    ) {
      problems.push(`${business.id}: tilstand utenfor 0-100`);
    }
    if (business.name.trim().length < 3) problems.push(`${business.id}: for kort navn`);
    if (business.description.trim().length < 15) {
      problems.push(`${business.id}: for kort beskrivelse`);
    }
  }

  for (const required of [
    'naerbutikk',
    'verksted',
    'drosjesentral',
    'nattklubb',
    'lagerfirma',
    'konsulentselskap',
  ]) {
    if (!BUSINESS_BY_ID.has(required)) problems.push(`Mangler virksomhet: ${required}`);
  }

  return problems;
}
