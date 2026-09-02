import { VITALS } from '@skyggeby/shared';
import type { PlayerDto } from '@skyggeby/shared';

/**
 * Projects the player's energy forward from the last server-settled value so
 * the bar keeps filling between requests. Purely cosmetic - the server settles
 * the real number on every action.
 */
export function projectedEnergy(player: PlayerDto, now: number): number {
  if (player.energy >= player.maxEnergy) return player.maxEnergy;

  const elapsed = Math.max(0, now - new Date(player.energyUpdatedAt).getTime()) / 1000;
  const ticks = Math.floor(elapsed / VITALS.secondsPerEnergy);

  return Math.min(player.maxEnergy, player.energy + ticks);
}

/** Seconds until the next point of energy, or null when the bar is full. */
export function secondsToNextEnergy(player: PlayerDto, now: number): number | null {
  if (projectedEnergy(player, now) >= player.maxEnergy) return null;

  const elapsed = Math.max(0, now - new Date(player.energyUpdatedAt).getTime()) / 1000;
  const remainder = elapsed % VITALS.secondsPerEnergy;

  return Math.max(1, Math.ceil(VITALS.secondsPerEnergy - remainder));
}
