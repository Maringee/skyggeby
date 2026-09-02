/**
 * Global, shared constants for SKYGGEBY.
 * These values are used by both the authoritative server and the client UI.
 * The client only renders them - the server is the single source of truth.
 */

export const GAME_NAME = 'SKYGGEBY';
export const GAME_TAGLINE = 'Byen sover aldri.';

/** Starting values for a freshly created player. */
export const STARTING_STATS = {
  cash: 2500,
  bankBalance: 0,
  health: 100,
  reputation: 0,
  heat: 0,
  level: 1,
  xp: 0,
  energy: 100,
  maxEnergy: 100,
  /** Every new player starts in Sentrum. See shared/src/districts.ts. */
  currentDistrictId: 'sentrum',
} as const;

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 18,
  passwordMin: 8,
  passwordMax: 128,
  maxHealth: 100,
  maxHeat: 100,
  /** Hard ceiling used to protect the economy from overflow. */
  maxMoney: 2_000_000_000,
  /** Hard ceiling on XP, so the Int32 column can never overflow. */
  maxXp: 2_000_000_000,
} as const;

/** How long a login session stays valid, in milliseconds (7 days). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = 'skyggeby_sid';

/**
 * Fee (as a fraction) charged by the bank on withdrawals. Always rounded up to
 * at least 1 kr so the fee cannot be avoided by splitting the withdrawal.
 */
export const BANK_WITHDRAWAL_FEE = 0.02;
