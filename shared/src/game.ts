import { LIMITS } from './constants';

/**
 * XP curve. Deliberately simple for the foundation, but centralised so the
 * progression can be tuned in one place later.
 *
 * Total XP required to reach a given level.
 */
export function xpRequiredForLevel(level: number): number {
  if (level <= 1) return 0;
  const n = level - 1;
  return Math.round(120 * n + 40 * n * n * 1.15);
}

export function xpForNextLevel(level: number): number {
  return xpRequiredForLevel(level + 1);
}

/** Resolves how far into the current level a player is, as 0..1. */
export function levelProgress(level: number, xp: number): number {
  const floor = xpRequiredForLevel(level);
  const ceiling = xpRequiredForLevel(level + 1);
  if (ceiling <= floor) return 1;
  return clamp01((xp - floor) / (ceiling - floor));
}

/** Given total XP, resolve which level that corresponds to. */
export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < 200 && xp >= xpRequiredForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function clampHealth(value: number): number {
  return Math.round(clamp(value, 0, LIMITS.maxHealth));
}

export function clampHeat(value: number): number {
  return Math.round(clamp(value, 0, LIMITS.maxHeat));
}

/** Norwegian label for the current heat level. */
export function heatLabel(heat: number): string {
  if (heat >= 85) return 'Etterlyst';
  if (heat >= 60) return 'Under overvåking';
  if (heat >= 35) return 'På radaren';
  if (heat >= 15) return 'Lagt merke til';
  return 'Ukjent';
}

/** Norwegian label for the player's standing in the underworld. */
export function reputationLabel(reputation: number): string {
  if (reputation >= 20000) return 'Legende';
  if (reputation >= 8000) return 'Skyggefyrste';
  if (reputation >= 3000) return 'Toneangivende';
  if (reputation >= 1000) return 'Etablert';
  if (reputation >= 250) return 'Kjent i gata';
  return 'Ingen';
}

export function healthLabel(health: number): string {
  if (health >= 90) return 'Uskadd';
  if (health >= 65) return 'Litt medtatt';
  if (health >= 40) return 'Skadet';
  if (health >= 15) return 'Kritisk';
  if (health > 0) return 'Døende';
  return 'Utslått';
}
