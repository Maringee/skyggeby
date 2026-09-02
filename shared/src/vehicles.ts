/**
 * Vehicles — the things a player actually drives.
 *
 * There is no second catalogue here. A vehicle *type* is an entry in
 * `assets.ts` with category VEHICLE, so the price, the description and the
 * wear rules have exactly one home and cannot drift apart. This file adds only
 * what an asset does not answer: how many you may own, and what a name is
 * allowed to look like.
 *
 * The distinction that matters in v1: an `Asset` is a thing you own, and a
 * `Vehicle` is where that thing *is* and whether you are driving it. The
 * player's district and the vehicle's district are two separate, server-owned
 * states, and nothing moves one because the other moved.
 */

import { ASSET_TYPES, type AssetTypeDefinition } from './assets';

export const VEHICLE_TUNING = {
  /** Hard ceiling on how many vehicles one player can own. */
  maxVehicles: 5,
  /** Player-chosen name, after trimming. */
  minNameLength: 3,
  maxNameLength: 32,
} as const;

/**
 * Every asset type that is a vehicle, in catalogue order.
 *
 * Derived rather than declared: adding a vehicle to `assets.ts` adds it here,
 * and no price can be copied wrong because no price is copied at all.
 */
export const VEHICLE_TYPES: readonly AssetTypeDefinition[] = ASSET_TYPES.filter(
  (type) => type.category === 'VEHICLE',
);

const VEHICLE_BY_ID = new Map<string, AssetTypeDefinition>(
  VEHICLE_TYPES.map((type) => [type.id, type]),
);

export function findVehicleType(id: string): AssetTypeDefinition | undefined {
  return VEHICLE_BY_ID.get(id);
}

export function isVehicleTypeId(id: string): boolean {
  return VEHICLE_BY_ID.has(id);
}

export const VEHICLE_TYPE_IDS: readonly string[] = VEHICLE_TYPES.map((t) => t.id);

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

export const VEHICLE_STATUS_LABELS = {
  active: 'Aktiv',
  parked: 'Parkert',
} as const;

export function vehicleStatusLabel(isActive: boolean): string {
  return isActive ? VEHICLE_STATUS_LABELS.active : VEHICLE_STATUS_LABELS.parked;
}

/**
 * Whether a vehicle can be driven from where it stands.
 *
 * The rule the whole system rests on: you can only act on a vehicle you are
 * standing next to. Kept here so the server and the interface agree on what
 * "here" means, though only the server's answer counts.
 */
export function isReachable(
  vehicleDistrictId: string,
  playerDistrictId: string,
): boolean {
  return vehicleDistrictId === playerDistrictId;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * Checks that the vehicle catalogue still holds together. Run from the tests,
 * so a bad entry in `assets.ts` fails the suite rather than reaching a player.
 */
export function validateVehicleCatalogue(): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();

  for (const type of VEHICLE_TYPES) {
    if (seenIds.has(type.id)) problems.push(`Duplikat id: ${type.id}`);
    seenIds.add(type.id);

    if (type.category !== 'VEHICLE') {
      problems.push(`${type.id}: er ikke et kjøretøy`);
    }
    if (!Number.isInteger(type.purchasePrice) || type.purchasePrice <= 0) {
      problems.push(`${type.id}: ugyldig kjøpspris`);
    }
    // A vehicle is never carried in a pocket, whatever else it is.
    if (type.inventoryEligible) {
      problems.push(`${type.id}: kjøretøy kan ikke bæres`);
    }
    if (type.name.trim().length < 3) problems.push(`${type.id}: for kort navn`);
    if (type.description.trim().length < 15) {
      problems.push(`${type.id}: for kort beskrivelse`);
    }
  }

  if (VEHICLE_TYPES.length === 0) problems.push('Katalogen har ingen kjøretøy');

  return problems;
}
