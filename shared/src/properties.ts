/**
 * Property — the places a player owns in the city.
 *
 * The catalogue lives here alongside districts, crimes, assets, contacts,
 * businesses and vehicles, so adding a property type is one entry and no
 * migration. Price, district, capacity and security are all read from this file
 * by the server; a client never sends a number that becomes money.
 *
 * A property is a *place*: it has a fixed address, and it stays there. The
 * player's district and the property's district are separate states, and
 * nothing moves one because the other moved.
 *
 * v1 is deliberately inert beyond ownership. `storageCapacity` and `security`
 * are stored and shown but wired to nothing - they are foundations for a later
 * storage and break-in system, not gameplay yet.
 */

import { DISTRICT_IDS, type DistrictId } from './districts';

export const PROPERTY_TUNING = {
  /** Hard ceiling on how many properties one player can own. */
  maxProperties: 3,
  /** Share of the purchase price a mint-condition property sells for. */
  saleValueFactor: 0.8,
  minCondition: 0,
  maxCondition: 100,
  /** Condition a freshly bought property starts at. */
  startCondition: 100,
  minSecurity: 1,
  maxSecurity: 5,
  /** Player-chosen name, after trimming. */
  minNameLength: 3,
  maxNameLength: 32,
} as const;

/* ------------------------------------------------------------------ *
 * Catalogue
 * ------------------------------------------------------------------ */

export interface PropertyTypeDefinition {
  /** Stable id. Never regenerated - owned rows point at it. */
  id: string;
  name: string;
  /** Norwegian flavour, one or two sentences. */
  description: string;
  /** Where the property stands. The player never chooses this. */
  districtId: DistrictId;
  purchasePrice: number;
  /** Room for things. Stored and shown; nothing consumes it in v1. */
  storageCapacity: number;
  /** 1-5. Stored and shown; nothing consumes it in v1. */
  security: number;
  /** 0-100. What a freshly bought property starts at. */
  condition: number;
}

export const PROPERTY_TYPES: readonly PropertyTypeDefinition[] = [
  {
    id: 'rom-i-kollektiv',
    name: 'Rom i kollektiv',
    description:
      'Én dør, fire naboer og en kjøkkenbenk ingen vasker. Billig, og ingen spør deg om noe.',
    districtId: 'blokkene',
    purchasePrice: 25000,
    storageCapacity: 5,
    security: 1,
    condition: 100,
  },
  {
    id: 'liten-leilighet',
    name: 'Liten leilighet',
    description:
      'To rom, egen lås og utsikt mot en bakgård. Det første stedet som faktisk er ditt.',
    districtId: 'blokkene',
    purchasePrice: 100000,
    storageCapacity: 10,
    security: 2,
    condition: 100,
  },
  {
    id: 'sentrumsleilighet',
    name: 'Sentrumsleilighet',
    description:
      'Midt i støyen, med portlås og naboer som ser en annen vei. Kort vei til alt.',
    districtId: 'sentrum',
    purchasePrice: 250000,
    storageCapacity: 15,
    security: 2,
    condition: 100,
  },
  {
    id: 'rekkehus',
    name: 'Rekkehus',
    description:
      'Egen inngang, egen bod og en garasje som rommer mer enn en bil. Havna sover tidlig.',
    districtId: 'havna',
    purchasePrice: 500000,
    storageCapacity: 25,
    security: 3,
    condition: 100,
  },
  {
    id: 'moderne-villa',
    name: 'Moderne villa',
    description:
      'Glass, betong og kameraer i hver eneste gesims. Alle vet hvem som bor her.',
    districtId: 'neon',
    purchasePrice: 1000000,
    storageCapacity: 40,
    security: 4,
    condition: 100,
  },
  {
    id: 'luksuseiendom',
    name: 'Luksuseiendom',
    description:
      'Port, plen og en adresse som åpner dører. Her spør ingen hvor pengene kom fra.',
    districtId: 'regjeringskvartalet',
    purchasePrice: 2500000,
    storageCapacity: 60,
    security: 5,
    condition: 100,
  },
];

const PROPERTY_BY_ID = new Map<string, PropertyTypeDefinition>(
  PROPERTY_TYPES.map((property) => [property.id, property]),
);

export function findPropertyType(id: string): PropertyTypeDefinition | undefined {
  return PROPERTY_BY_ID.get(id);
}

export function isPropertyTypeId(id: string): boolean {
  return PROPERTY_BY_ID.has(id);
}

export const PROPERTY_TYPE_IDS: readonly string[] = PROPERTY_TYPES.map((p) => p.id);

/* ------------------------------------------------------------------ *
 * Value
 * ------------------------------------------------------------------ */

export function clampPropertyCondition(condition: number): number {
  return Math.round(
    Math.min(
      PROPERTY_TUNING.maxCondition,
      Math.max(PROPERTY_TUNING.minCondition, condition),
    ),
  );
}

/**
 * What a property is worth now.
 *
 * Always computed from the price stored on the row, never from the catalogue: a
 * later rebalancing must not quietly change what a place somebody already owns
 * is worth.
 */
export function calculatePropertyValue(purchasePrice: number, condition: number): number {
  const factor = clampPropertyCondition(condition) / 100;
  return Math.max(0, Math.floor(purchasePrice * factor));
}

/**
 * What a property sells for.
 *
 * Selling always loses money: 80 % of what was paid, scaled by condition and
 * rounded down, exactly as assets work. The house never rounds in the player's
 * favour.
 */
export function calculatePropertySaleValue(
  purchasePrice: number,
  condition: number,
): number {
  const factor = clampPropertyCondition(condition) / 100;
  return Math.max(
    0,
    Math.floor(purchasePrice * PROPERTY_TUNING.saleValueFactor * factor),
  );
}

/** Norwegian label for a security rating, 1-5. */
export function propertySecurityLabel(security: number): string {
  if (security >= 5) return 'Svært høy';
  if (security >= 4) return 'Høy';
  if (security >= 3) return 'Middels';
  if (security >= 2) return 'Lav';
  return 'Svært lav';
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * Checks the catalogue against its own rules. Run from the tests, so a bad
 * entry fails the suite rather than reaching a player.
 */
export function validatePropertyCatalogue(): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const property of PROPERTY_TYPES) {
    if (seenIds.has(property.id)) problems.push(`Duplikat id: ${property.id}`);
    seenIds.add(property.id);

    if (seenNames.has(property.name)) problems.push(`Duplikat navn: ${property.name}`);
    seenNames.add(property.name);

    if (!(DISTRICT_IDS as readonly string[]).includes(property.districtId)) {
      problems.push(`${property.id}: ukjent distrikt ${property.districtId}`);
    }
    if (!Number.isInteger(property.purchasePrice) || property.purchasePrice <= 0) {
      problems.push(`${property.id}: ugyldig kjøpspris`);
    }
    if (!Number.isInteger(property.storageCapacity) || property.storageCapacity <= 0) {
      problems.push(`${property.id}: lagringsplass må være over 0`);
    }
    if (
      property.security < PROPERTY_TUNING.minSecurity ||
      property.security > PROPERTY_TUNING.maxSecurity
    ) {
      problems.push(`${property.id}: sikkerhet utenfor 1-5`);
    }
    if (
      property.condition < PROPERTY_TUNING.minCondition ||
      property.condition > PROPERTY_TUNING.maxCondition
    ) {
      problems.push(`${property.id}: tilstand utenfor 0-100`);
    }
    if (property.name.trim().length < 3) problems.push(`${property.id}: for kort navn`);
    if (property.description.trim().length < 15) {
      problems.push(`${property.id}: for kort beskrivelse`);
    }
  }

  for (const required of [
    'rom-i-kollektiv',
    'liten-leilighet',
    'sentrumsleilighet',
    'rekkehus',
    'moderne-villa',
    'luksuseiendom',
  ]) {
    if (!PROPERTY_BY_ID.has(required)) problems.push(`Mangler eiendom: ${required}`);
  }

  return problems;
}
