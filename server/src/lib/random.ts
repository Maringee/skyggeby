import crypto from 'node:crypto';

/** Inclusive integer in [min, max], drawn from a cryptographic source. */
export function randomInt(min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  if (low === high) return low;
  return crypto.randomInt(low, high + 1);
}

/** Uniform float in [0, 1). */
export function randomChance(): number {
  return crypto.randomInt(0, 1_000_000) / 1_000_000;
}

export function pickOne<T>(items: readonly T[], fallback: T): T {
  if (items.length === 0) return fallback;
  return items[crypto.randomInt(0, items.length)] ?? fallback;
}

/** Inclusive integer inside a balance-table range. */
export function rollRange(range: { min: number; max: number }): number {
  return randomInt(range.min, range.max);
}
