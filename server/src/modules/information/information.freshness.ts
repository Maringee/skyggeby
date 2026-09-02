import type { Information } from '@prisma/client';
import {
  FRESHNESS_BONUS_FACTOR,
  currentValue,
  resolveFreshness,
  type Freshness,
} from '@skyggeby/shared';

/**
 * Freshness for a stored row. A thin wrapper over the shared maths so the
 * server never re-implements the rules the client renders from.
 */
export function freshnessOf(row: Information, now: Date = new Date()): Freshness {
  return resolveFreshness(
    { discoveredAt: row.discoveredAt, expiresAt: row.expiresAt, usedAt: row.usedAt },
    now,
  );
}

/** How much of its crime bonus the row still carries. */
export function bonusFactorOf(row: Information, now: Date = new Date()): number {
  return FRESHNESS_BONUS_FACTOR[freshnessOf(row, now)] ?? 0;
}

/** What the row is worth right now. */
export function worthOf(row: Information, now: Date = new Date()): number {
  return currentValue(row.baseValue, freshnessOf(row, now));
}
