import type { CrimeBlockedReason } from './types';

/**
 * Central balance table for every crime in SKYGGEBY.
 *
 * This file is the ONLY place where crime economy is tuned. The client reads it
 * to render requirements and risk, but the server is the only party that ever
 * applies it: a client can ask to commit a crime, never decide the outcome.
 */

export const CRIME_IDS = [
  'lommetyveri',
  'butikktyveri',
  'innbrudd',
  'bilkapring',
  'lagerinnbrudd',
] as const;

export type CrimeId = (typeof CRIME_IDS)[number];

export interface CrimeRange {
  min: number;
  max: number;
}

export interface CrimeDefinition {
  id: CrimeId;
  name: string;
  /** Short Norwegian pitch shown on the crime card. */
  description: string;
  /** Flavour name of the spot the job happens at, e.g. "Holdeplassen".
   *  Not a city district - those live in districts.ts. */
  scene: string;
  minLevel: number;
  energyCost: number;
  cooldownSeconds: number;
  /** Base success chance, 0..1, before player modifiers. */
  successChance: number;
  /** Cash gained on success. */
  reward: CrimeRange;
  /** XP gained on success. */
  xp: CrimeRange;
  /** Small consolation XP on failure - you still learn something. */
  failXp: CrimeRange;
  /** Heat added when it goes well (someone always notices something). */
  heatOnSuccess: CrimeRange;
  /** Heat added when it goes badly. */
  heatOnFailure: CrimeRange;
  /** Health lost on failure, as positive numbers. */
  healthOnFailure: CrimeRange;
  /** Cash lost on failure, as positive numbers. Clamped to what you carry. */
  fineOnFailure: CrimeRange;
  successTexts: string[];
  failureTexts: string[];
}

/** Global modifiers. Tuned here so no magic numbers leak into the services. */
export const CRIME_TUNING = {
  /**
   * How much of the success chance police pressure can eat. At 100 heat the
   * player loses this much of their chance, expressed as a fraction.
   */
  maxHeatPenalty: 0.22,
  /** Success chance is never allowed below this, no matter the heat. */
  minEffectiveChance: 0.05,
  /**
   * ...nor above this, no matter how quiet the district. Without a ceiling a
   * low-police area could push an easy job to near-certainty and flatten the
   * risk curve the whole balance table is built on.
   */
  maxEffectiveChance: 0.95,
  /** A player needs at least this much health to work. */
  minHealthToAct: 10,
} as const;

export const CRIMES: readonly CrimeDefinition[] = [
  {
    id: 'lommetyveri',
    name: 'Lommetyveri',
    description:
      'Trikkeholdeplassen er full av folk som stirrer ned i mobilen. En lett hånd, og lommeboka bytter eier.',
    scene: 'Holdeplassen',
    minLevel: 1,
    energyCost: 2,
    cooldownSeconds: 45,
    successChance: 0.85,
    reward: { min: 60, max: 180 },
    xp: { min: 8, max: 14 },
    failXp: { min: 2, max: 4 },
    heatOnSuccess: { min: 0, max: 2 },
    heatOnFailure: { min: 2, max: 5 },
    healthOnFailure: { min: 0, max: 3 },
    fineOnFailure: { min: 0, max: 0 },
    successTexts: [
      'Du gled forbi en distrahert pendler og hadde lommeboka i jakka før trikken kom.',
      'To fingre, ett sekund. Ingen så noe som helst.',
      'Du snublet inn i en mann med altfor tynn bukselomme, og beklaget høflig.',
    ],
    failureTexts: [
      'Hun kjente hånda med én gang og skrek. Du gikk raskt rundt hjørnet.',
      'Lommeboka satt fast. Du fikk et albuestøt og ingenting annet.',
      'En vekter så deg i speilbildet i kioskvinduet. Du forsvant tomhendt.',
    ],
  },
  {
    id: 'butikktyveri',
    name: 'Butikktyveri',
    description:
      'Kiosken på hjørnet har ett kamera og null vakthold. Du vet nøyaktig hvor de dyre tingene står.',
    scene: 'Nedre gate',
    minLevel: 3,
    energyCost: 4,
    cooldownSeconds: 150,
    successChance: 0.72,
    reward: { min: 220, max: 520 },
    xp: { min: 18, max: 30 },
    failXp: { min: 4, max: 9 },
    heatOnSuccess: { min: 1, max: 4 },
    heatOnFailure: { min: 5, max: 9 },
    healthOnFailure: { min: 2, max: 6 },
    fineOnFailure: { min: 0, max: 0 },
    successTexts: [
      'Du gikk ut med jakka full mens kassa hadde trøbbel med kølappsystemet.',
      'Alarmen var aldri slått på. Du tømte hele hylla i ro og mak.',
      'Du ba om å få se noe bak disken, og forsynte deg mens ryggen var vendt.',
    ],
    failureTexts: [
      'Alarmen ulte i døra. Du løp, men varene ble igjen.',
      'Butikkeieren tok tak i jakka di. Du slet deg løs med et revet erme.',
      'Det stod en sivil vakt ved utgangen. Du la alt pent tilbake og gikk.',
    ],
  },
  {
    id: 'innbrudd',
    name: 'Innbrudd',
    description:
      'En leilighet i tredje etasje har stått mørk i fire dager. Postkassa er full, og balkongdøra er gammel.',
    scene: 'Bakgårdene',
    minLevel: 7,
    energyCost: 7,
    cooldownSeconds: 420,
    successChance: 0.58,
    reward: { min: 750, max: 1700 },
    xp: { min: 45, max: 75 },
    failXp: { min: 10, max: 20 },
    heatOnSuccess: { min: 3, max: 7 },
    heatOnFailure: { min: 9, max: 15 },
    healthOnFailure: { min: 5, max: 12 },
    fineOnFailure: { min: 0, max: 0 },
    successTexts: [
      'Balkongdøra ga etter på første forsøk. Du var ute igjen på elleve minutter.',
      'Smykkeskrinet stod i nattbordet, akkurat der du gjettet at det ville stå.',
      'Du gikk ut hovedinngangen med en pappeske og nikket til naboen.',
    ],
    failureTexts: [
      'De var hjemme likevel. Du hoppet ned fra balkongen og landet feil.',
      'Naboen ringte politiet mens du fortsatt stod i gangen.',
      'En hund du ikke visste om møtte deg rett innenfor døra.',
    ],
  },
  {
    id: 'bilkapring',
    name: 'Bilkapring',
    description:
      'Parkeringshuset ved havna har en tysk stasjonsvogn på plan fire. Kameraene peker feil vei.',
    scene: 'Havnelageret',
    minLevel: 12,
    energyCost: 10,
    cooldownSeconds: 900,
    successChance: 0.47,
    reward: { min: 2200, max: 4800 },
    xp: { min: 110, max: 180 },
    failXp: { min: 20, max: 40 },
    heatOnSuccess: { min: 6, max: 12 },
    heatOnFailure: { min: 14, max: 22 },
    healthOnFailure: { min: 8, max: 18 },
    fineOnFailure: { min: 150, max: 400 },
    successTexts: [
      'Du var ute av parkeringshuset før bommen rakk å lukke seg.',
      'Nøkkelsignalet lot seg forlenge. Bilen startet som om den var din.',
      'Du kjørte rolig ut, blinket høyre, og forsvant i trafikken.',
    ],
    failureTexts: [
      'Sporingen slo inn etter to kvartaler. Du forlot bilen og løp.',
      'Eieren kom tilbake midt i det hele. Det ble håndgemeng.',
      'En patruljebil stod tvers over utkjørselen. Du måtte etterlate alt.',
    ],
  },
  {
    id: 'lagerinnbrudd',
    name: 'Lagerinnbrudd',
    description:
      'Et lager på industrifeltet tar imot paller om natta. Vaktbua er bemannet av én mann og en termos.',
    scene: 'Industrifeltet',
    minLevel: 18,
    energyCost: 14,
    cooldownSeconds: 1800,
    successChance: 0.38,
    reward: { min: 6000, max: 13000 },
    xp: { min: 260, max: 420 },
    failXp: { min: 45, max: 85 },
    heatOnSuccess: { min: 9, max: 17 },
    heatOnFailure: { min: 20, max: 30 },
    healthOnFailure: { min: 12, max: 25 },
    fineOnFailure: { min: 400, max: 1200 },
    successTexts: [
      'Dere lastet en halv palle på tjue minutter og kjørte ut med lysene av.',
      'Vakta sov. Porten stod åpen. Noen ganger er byen snill mot deg.',
      'Du visste hvilken container som var verdt noe, og tok bare den.',
    ],
    failureTexts: [
      'Bevegelsessensorene var nye. Hele området ble badet i lys.',
      'Vakta var våken, og han var ikke alene.',
      'Porten gikk i lås bak dere. Dere kom dere ut, men uten noe.',
    ],
  },
];

const CRIME_BY_ID = new Map<string, CrimeDefinition>(
  CRIMES.map((crime) => [crime.id, crime]),
);

export function findCrime(id: string): CrimeDefinition | undefined {
  return CRIME_BY_ID.get(id);
}

export function isCrimeId(id: string): id is CrimeId {
  return CRIME_BY_ID.has(id);
}

/**
 * Success chance after the player's own situation is taken into account.
 * Heat makes everything harder - the city is watching.
 */
export function effectiveSuccessChance(crime: CrimeDefinition, heat: number): number {
  const pressure = Math.max(0, Math.min(100, heat)) / 100;
  const penalty = pressure * CRIME_TUNING.maxHeatPenalty;
  return Math.max(CRIME_TUNING.minEffectiveChance, crime.successChance - penalty);
}

/** Norwegian risk label derived from the effective chance. */
export function riskLabel(chance: number): string {
  if (chance >= 0.8) return 'Lav risiko';
  if (chance >= 0.62) return 'Moderat risiko';
  if (chance >= 0.45) return 'Høy risiko';
  if (chance >= 0.28) return 'Svært høy risiko';
  return 'Desperat';
}

/** Human readable duration, e.g. "6 min" or "45 sek". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  if (seconds < 60) return `${seconds} sek`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} sek`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} t` : `${hours} t ${restMinutes} min`;
}

export interface CrimeRequirementState {
  level: number;
  energy: number;
  health: number;
  cooldownRemainingSeconds: number;
}

export interface CrimeBlock {
  reason: CrimeBlockedReason | null;
  /** Norwegian explanation shown under the button, or null when available. */
  text: string | null;
}

/**
 * Decides whether a crime can be attempted, and why not.
 *
 * Shared so the server's enforcement and the client's greyed-out button always
 * agree. The server is still the only one whose verdict counts.
 */
export function resolveCrimeBlock(
  crime: CrimeDefinition,
  state: CrimeRequirementState,
): CrimeBlock {
  if (state.level < crime.minLevel) {
    return { reason: 'NIVA', text: `Krever nivå ${crime.minLevel}.` };
  }
  if (state.cooldownRemainingSeconds > 0) {
    return {
      reason: 'AVKJOLING',
      text: `Klar om ${formatDuration(state.cooldownRemainingSeconds)}.`,
    };
  }
  if (state.health < CRIME_TUNING.minHealthToAct) {
    return {
      reason: 'HELSE',
      text: `For skadet. Krever minst ${CRIME_TUNING.minHealthToAct} i helse.`,
    };
  }
  if (state.energy < crime.energyCost) {
    return {
      reason: 'ENERGI',
      text: `Krever ${crime.energyCost} energi, du har ${state.energy}.`,
    };
  }
  return { reason: null, text: null };
}
