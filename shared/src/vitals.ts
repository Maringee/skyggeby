/**
 * Passive, time-based player vitals: energy regeneration and heat decay.
 *
 * The math lives here so the client can render a truthful bar between requests,
 * but only the server ever writes the result to the database.
 */

export const VITALS = {
  /** Energy a fresh player starts with, and their ceiling. */
  maxEnergy: 100,
  /** Seconds of real time per single point of energy regained. */
  secondsPerEnergy: 20,
  /** Seconds of real time per single point of heat that cools off. */
  secondsPerHeatDecay: 240,
} as const;

export interface RegenInput {
  energy: number;
  heat: number;
  /** When energy was last settled. */
  energyUpdatedAt: Date;
  /** When heat was last settled. */
  heatUpdatedAt: Date;
  maxEnergy: number;
}

export interface RegenResult {
  energy: number;
  heat: number;
  energyUpdatedAt: Date;
  heatUpdatedAt: Date;
  energyGained: number;
  heatDecayed: number;
}

/**
 * Settles the passive changes that have accrued since the last update.
 *
 * The leftover fraction of a tick is preserved by only advancing the timestamp
 * by the whole ticks consumed, so no progress is ever lost to rounding.
 */
export function regenerateVitals(input: RegenInput, now: Date = new Date()): RegenResult {
  const result: RegenResult = {
    energy: input.energy,
    heat: input.heat,
    energyUpdatedAt: input.energyUpdatedAt,
    heatUpdatedAt: input.heatUpdatedAt,
    energyGained: 0,
    heatDecayed: 0,
  };

  const nowMs = now.getTime();

  // Energy
  if (input.energy < input.maxEnergy) {
    const elapsed = Math.max(0, nowMs - input.energyUpdatedAt.getTime()) / 1000;
    const ticks = Math.floor(elapsed / VITALS.secondsPerEnergy);
    if (ticks > 0) {
      const gained = Math.min(ticks, input.maxEnergy - input.energy);
      result.energy = input.energy + gained;
      result.energyGained = gained;
      result.energyUpdatedAt = new Date(
        input.energyUpdatedAt.getTime() + ticks * VITALS.secondsPerEnergy * 1000,
      );
    }
  } else {
    // Already full: keep the clock current so it does not bank idle time.
    result.energyUpdatedAt = now;
  }

  // Heat
  if (input.heat > 0) {
    const elapsed = Math.max(0, nowMs - input.heatUpdatedAt.getTime()) / 1000;
    const ticks = Math.floor(elapsed / VITALS.secondsPerHeatDecay);
    if (ticks > 0) {
      const decayed = Math.min(ticks, input.heat);
      result.heat = input.heat - decayed;
      result.heatDecayed = decayed;
      result.heatUpdatedAt = new Date(
        input.heatUpdatedAt.getTime() + ticks * VITALS.secondsPerHeatDecay * 1000,
      );
    }
  } else {
    result.heatUpdatedAt = now;
  }

  return result;
}

/** Seconds until the next single point of energy arrives, or null when full. */
export function secondsUntilNextEnergy(
  energy: number,
  maxEnergy: number,
  energyUpdatedAt: string,
  now: number = Date.now(),
): number | null {
  if (energy >= maxEnergy) return null;
  const elapsed = Math.max(0, now - new Date(energyUpdatedAt).getTime()) / 1000;
  const remainder = elapsed % VITALS.secondsPerEnergy;
  return Math.max(0, Math.ceil(VITALS.secondsPerEnergy - remainder));
}
