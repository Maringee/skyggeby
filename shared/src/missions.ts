/**
 * Oppdrag - the missions that tie the rest of Skyggeby together.
 *
 * The catalogue lives here alongside crimes, districts, contacts, assets,
 * businesses, vehicles and properties, so adding a mission is one entry and no
 * migration. Every reward is read from this file by the server; a client never
 * sends a number that becomes money, experience or trust.
 *
 * A mission deliberately introduces no new verb. Its objectives are written in
 * terms of things the player can already do - commit a crime, explore a
 * district, drive a car somewhere, carry a tool, put money in the bank, hold a
 * piece of knowledge - and the mission's only job is to give those actions a
 * reason and a payer. If an objective here cannot be satisfied by existing
 * gameplay, it is the wrong objective.
 *
 * Two structural rules keep the system honest:
 *
 *  - `category` is a label, not a straitjacket. It decides an icon and a filter
 *    in the interface and nothing else. Objectives are a free list, so a
 *    "transport" mission may perfectly well also ask you to keep your heat down.
 *
 *  - A mission carries at most one *event* objective (see `isEventObjective`)
 *    alongside up to two state objectives. Event objectives are the only ones
 *    that need a stored counter, and one counter per mission row is the entire
 *    persistence cost of the system. A mission that would need two counted
 *    actions is two missions in a chain.
 */

import { isAssetTypeId } from './assets';
import { isContactId } from './contacts';
import { isCrimeId } from './crimes';
import { isDistrictId, type DistrictId } from './districts';
import { INFORMATION_RELEVANCE, type InformationRelevance } from './information';
import { SKILL_TUNING, isSkillId, type SkillId } from './skills';
import { isVehicleTypeId } from './vehicles';

export const MISSION_TUNING = {
  /** How many missions one player may have running at once. */
  maxActive: 3,
  /** Wait after abandoning before the same mission can be taken again. */
  abandonCooldownSeconds: 30 * 60,
  /** Wait after letting a mission expire. Slightly heavier than abandoning. */
  expiredCooldownSeconds: 60 * 60,
  /** Deadline given to the few missions that have one. */
  defaultExpirySeconds: 6 * 60 * 60,
  /** Wait before a repeatable mission comes back. */
  defaultRepeatCooldownSeconds: 4 * 60 * 60,
  /** Ceiling on objectives per mission, enforced by the catalogue validator. */
  maxObjectives: 3,
  /** How fresh knowledge must be to satisfy a KUNNSKAP objective, in hours. */
  knowledgeMaxAgeHours: 6,
} as const;

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

/** What a stored mission row can be. Mirrored by a database CHECK. */
export const MISSION_STATUSES = ['AKTIV', 'FULLFORT', 'AVBRUTT', 'UTLOPT'] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

/**
 * What the player sees. Only three of these are ever rows: the other three are
 * computed from the catalogue and the player's own state at request time, the
 * same lazy evaluation the businesses use for settlement.
 */
export const MISSION_AVAILABILITIES = [
  'TILGJENGELIG',
  'LAAST',
  'AKTIV',
  'FULLFORT',
  'SPERRET',
  'SKJULT',
] as const;
export type MissionAvailability = (typeof MISSION_AVAILABILITIES)[number];

export const MISSION_AVAILABILITY_LABELS: Record<MissionAvailability, string> = {
  TILGJENGELIG: 'Tilgjengelig',
  LAAST: 'Låst',
  AKTIV: 'Aktivt',
  FULLFORT: 'Fullført',
  SPERRET: 'Sperret',
  SKJULT: 'Skjult',
};

/* ------------------------------------------------------------------ *
 * Category
 * ------------------------------------------------------------------ */

/**
 * A presentational grouping, matched to the six contact trades so a mechanic
 * feels different from an informant. It carries no rules: nothing in the
 * evaluator ever reads it.
 */
export const MISSION_CATEGORIES = [
  'GATE',
  'ETTERRETNING',
  'TRANSPORT',
  'ANSKAFFELSE',
  'OKONOMI',
  'DISKRESJON',
] as const;
export type MissionCategory = (typeof MISSION_CATEGORIES)[number];

export const MISSION_CATEGORY_LABELS: Record<MissionCategory, string> = {
  GATE: 'Gata',
  ETTERRETNING: 'Etterretning',
  TRANSPORT: 'Transport',
  ANSKAFFELSE: 'Anskaffelse',
  OKONOMI: 'Økonomi',
  DISKRESJON: 'Diskresjon',
};

/* ------------------------------------------------------------------ *
 * Objectives
 * ------------------------------------------------------------------ */

/**
 * The work a mission asks for.
 *
 * Split into two families, which is the only distinction the machinery cares
 * about:
 *
 *  - **Event objectives** (`KRIM`, `UTFORSK`, `PRAT`, `KJOR`,
 *    `INNSKUDD`) count something the player *does*. They are advanced by the
 *    existing services as they resolve, inside the transaction that already
 *    holds the player's row lock, and they are the reason a mission row stores
 *    a counter at all.
 *
 *  - **State objectives** (everything else) read what is true at the moment of
 *    delivery. They need no counter and no hook: the server looks at the
 *    database and answers.
 *
 * `KUNNSKAP` deserves a note. Information in Skyggeby is knowledge, not cargo:
 * it lives in its own table, it is never an inventory item, it occupies no
 * slots, and it cannot be carried, dropped or handed over. The objective asks
 * whether the player *knows* something current about a place - nothing more.
 */
export type MissionObjective =
  /** Succeed at a crime, optionally pinned to a district. */
  | { kind: 'KRIM'; crimeId: string; districtId?: DistrictId; count: number }
  /** Explore, optionally in one district, optionally turning up a relevance. */
  | {
      kind: 'UTFORSK';
      districtId?: DistrictId;
      relevance?: InformationRelevance;
      count: number;
    }
  /** Talk to one specific person. */
  | { kind: 'PRAT'; contactId: string; count: number }
  /** Drive a vehicle there. Moving yourself does not satisfy this. */
  | { kind: 'KJOR'; districtId: DistrictId; count: number }
  /** Put money in the bank. Accumulates across deposits. */
  | { kind: 'INNSKUDD'; amount: number }
  /** Carry a specific tool in the inventory. */
  | { kind: 'BAER'; assetTypeId: string }
  /** Carry valuables worth at least this much, whatever they are. */
  | { kind: 'VERDI_BAERES'; minValue: number }
  /** Own a vehicle, optionally of certain types, in a district, in condition. */
  | {
      kind: 'EIE_KJORETOY';
      vehicleTypeIds?: readonly string[];
      districtId?: DistrictId;
      minCondition?: number;
    }
  | { kind: 'EIE_VIRKSOMHET'; count: number; districtId?: DistrictId }
  | { kind: 'EIE_EIENDOM'; count: number; districtId?: DistrictId }
  /** Money on the bank account, not in a pocket. */
  | { kind: 'BANK'; amount: number }
  | { kind: 'KONTANTER'; amount: number }
  | { kind: 'HEAT_UNDER'; maxHeat: number }
  /** Hold current, unspent knowledge of a kind. Never an item. */
  | { kind: 'KUNNSKAP'; relevance: InformationRelevance; districtId?: DistrictId }
  /** Stand in a district when delivering. */
  | { kind: 'VAER_I'; districtId: DistrictId };

export type MissionObjectiveKind = MissionObjective['kind'];

/** The kinds advanced by something happening, rather than read at delivery. */
export const EVENT_OBJECTIVE_KINDS = [
  'KRIM',
  'UTFORSK',
  'PRAT',
  'KJOR',
  'INNSKUDD',
] as const;

export function isEventObjective(objective: MissionObjective): boolean {
  return (EVENT_OBJECTIVE_KINDS as readonly string[]).includes(objective.kind);
}

/**
 * How far an event objective has to get. State objectives return 1 so progress
 * can be expressed uniformly as "x of y" in the interface.
 */
export function objectiveTarget(objective: MissionObjective): number {
  switch (objective.kind) {
    case 'KRIM':
    case 'UTFORSK':
    case 'PRAT':
    case 'KJOR':
      return objective.count;
    case 'INNSKUDD':
      return objective.amount;
    default:
      return 1;
  }
}

/** The single event objective of a mission, if it has one. */
export function eventObjectiveOf(
  mission: MissionDefinition,
): MissionObjective | undefined {
  return mission.objectives.find(isEventObjective);
}

/* ------------------------------------------------------------------ *
 * Requirements, rewards, chains
 * ------------------------------------------------------------------ */

/**
 * What must be true before a mission can be accepted at all.
 *
 * Deliberately narrower than the objectives: requirements are a doorway, the
 * objectives are the room. Both are checked server-side, and both are checked
 * again at delivery - accepting a mission is not a ticket.
 */
export interface MissionRequirements {
  /** Trust with the mission's own contact. 0 means "knowing them is enough". */
  minTrust: number;
  minCash?: number;
  minBank?: number;
  /** Heat must be at or below this to take the job. */
  maxHeat?: number;
  ownsAssetTypeId?: string;
  ownsVehicle?: boolean;
  ownsBusinessCount?: number;
  ownsPropertyCount?: number;
  /**
   * A trained skill, read from the existing PlayerSkill rows.
   *
   * Deliberately points at the same catalogue the skill screen spends points
   * in - there is no second progression here. It is the first thing in the
   * game to consume a dormant skill, which is why the two missions that use
   * one ask for `mobilitet` and `forretning`: no existing number changes, and
   * points spent there stop being points spent on nothing.
   */
  minSkill?: { skillId: SkillId; level: number };
}

/**
 * What the contact pays.
 *
 * Money goes through the ledger like every other krone in the game, experience
 * goes through `grantXp`, trust goes through `adjustTrust`. Nothing here is a
 * new economy - it is the existing ones, credited from a new source.
 */
export interface MissionRewards {
  cash: number;
  xp: number;
  /** Trust with the mission's own contact. */
  trust: number;
  /** Negative removes heat. A favour, not a payment. */
  heatChange: number;
  /** A guaranteed, current piece of knowledge. Never an item. */
  information: {
    relevance: InformationRelevance;
    districtId: DistrictId;
  } | null;
}

/**
 * What finishing opens up.
 *
 * Unlocking is a reward in its own right and is reported as one: a contact
 * unlocked here is a real relationship row, created because that person now
 * seeks the player out. It is not a flag - it is somebody new to work with.
 */
export interface MissionUnlocks {
  missionIds: readonly string[];
  contactIds: readonly string[];
}

export interface MissionDefinition {
  /** Stable id. Never regenerated - stored rows point at it. */
  id: string;
  name: string;
  /** Who hands it out. Always a real person from the contact catalogue. */
  contactId: string;
  category: MissionCategory;
  minLevel: number;
  /** What the contact says when offering the job. */
  briefing: string;
  /** What they say when it is done. */
  debriefing: string;
  requirements: MissionRequirements;
  objectives: readonly MissionObjective[];
  rewards: MissionRewards;
  /** Chain: hidden entirely until every one of these is completed. */
  requiresMissions: readonly string[];
  unlocks: MissionUnlocks;
  repeatable: boolean;
  /** Only meaningful when `repeatable`. */
  repeatCooldownSeconds: number | null;
  /** A deadline, for the few missions that have one. */
  expiresInSeconds: number | null;
}

/* ------------------------------------------------------------------ *
 * Catalogue
 * ------------------------------------------------------------------ *
 *
 * Eighteen missions across four crossing chains. The level bands are tuned so
 * missions supply roughly a third of the experience needed to get through each
 * one: enough to feel like the fastest road, never enough to replace the game
 * underneath it.
 *
 *   nivå 1-3   270 XP av 774     nivå 4-6   630 XP av 1602
 *   nivå 7-10  950 XP av 2430
 */

export const MISSIONS: readonly MissionDefinition[] = [
  /* ---------------- Nivå 1-3 ---------------- */
  {
    id: 'kraka_forste_tips',
    name: 'Kråkas første tips',
    contactId: 'kraka',
    category: 'GATE',
    minLevel: 1,
    briefing:
      'Kråka nikker mot trappeoppgangen. «Folk her går med lommene fulle og hodet et helt annet sted. Ta to av dem, så vet jeg at du er verdt å snakke med.»',
    debriefing:
      '«Der ja.» Kråka teller opp sedlene uten å se på deg. «Nå vet i hvert fall jeg hvem du er.»',
    requirements: { minTrust: 0 },
    objectives: [{ kind: 'KRIM', crimeId: 'lommetyveri', districtId: 'blokkene', count: 2 }],
    rewards: {
      cash: 250,
      xp: 35,
      trust: 4,
      heatChange: 0,
      information: null,
    },
    requiresMissions: [],
    unlocks: { missionIds: ['kraka_butikken'], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'gunnar_lykta',
    name: 'Noe å se med',
    contactId: 'gunnar_toft',
    category: 'ANSKAFFELSE',
    minLevel: 2,
    briefing:
      'Gunnar tørker hendene på en fille. «Du kommer ingen vei i mørket uten lys. Skaff deg en lommelykt og kom hit med den, så skal jeg vise deg noe.»',
    debriefing:
      '«Bra. Den koster lite og redder deg oftere enn du tror.» Han skyver noen sedler over benken.',
    requirements: { minTrust: 20 },
    objectives: [
      { kind: 'BAER', assetTypeId: 'lommelykt' },
      { kind: 'VAER_I', districtId: 'sentrum' },
    ],
    rewards: {
      cash: 450,
      xp: 40,
      trust: 4,
      heatChange: 0,
      information: null,
    },
    requiresMissions: [],
    unlocks: { missionIds: ['marius_bilen'], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'mette_ryktet',
    name: 'Ryktet på kaia',
    contactId: 'mette_dal',
    category: 'ETTERRETNING',
    minLevel: 2,
    briefing:
      'Mette snakker lavt. «Det skjer noe nede ved containerne, men jeg får ikke tak i hva. Gå en runde her og finn ut hva slags aktivitet det er snakk om.»',
    debriefing:
      '«Så det var det de holdt på med.» Hun ser lettet ut. «Du hører etter. Det er sjeldnere enn du tror.»',
    requirements: { minTrust: 20 },
    objectives: [
      { kind: 'UTFORSK', districtId: 'havna', count: 1 },
      { kind: 'KUNNSKAP', relevance: 'AKTIVITET', districtId: 'havna' },
    ],
    rewards: {
      cash: 500,
      xp: 45,
      trust: 4,
      heatChange: 0,
      information: null,
    },
    requiresMissions: [],
    unlocks: { missionIds: ['amir_leveransen'], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'kraka_butikken',
    name: 'Butikken i gata',
    contactId: 'kraka',
    category: 'GATE',
    minLevel: 3,
    briefing:
      'Kråka lener seg fram. «Kiosken på hjørnet har én ansatt og null kameraer. Men gjør det pent - kommer du tilbake med halve byen etter deg, kjenner jeg deg ikke.»',
    debriefing:
      '«Og ingen så deg.» Kråka smiler for første gang. «Det er en fyr du bør møte. Oskar. Jeg sier fra at du kommer.»',
    requirements: { minTrust: 0 },
    objectives: [
      { kind: 'KRIM', crimeId: 'butikktyveri', districtId: 'blokkene', count: 1 },
      { kind: 'HEAT_UNDER', maxHeat: 30 },
    ],
    rewards: {
      cash: 900,
      xp: 60,
      trust: 5,
      heatChange: 0,
      information: null,
    },
    requiresMissions: ['kraka_forste_tips'],
    unlocks: { missionIds: [], contactIds: ['oskar_lind'] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'sara_advarselen',
    name: 'En vennlig advarsel',
    contactId: 'sara_viken',
    category: 'DISKRESJON',
    minLevel: 3,
    briefing:
      'Sara møter deg ikke på stasjonen. «Navnet ditt har begynt å dukke opp. Legg deg flat en stund, og kom tilbake når det har roet seg. Da skal du få vite hvem som spør.»',
    debriefing:
      '«Bedre.» Hun gir deg et sammenbrettet ark. «Behold dette. Og husk hvem som ga deg det.»',
    requirements: { minTrust: 20 },
    objectives: [
      { kind: 'HEAT_UNDER', maxHeat: 10 },
      { kind: 'VAER_I', districtId: 'sentrum' },
    ],
    rewards: {
      cash: 0,
      xp: 45,
      trust: 6,
      heatChange: 0,
      information: { relevance: 'POLITI', districtId: 'sentrum' },
    },
    requiresMissions: [],
    unlocks: { missionIds: ['karin_dossieret'], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'nina_visningen',
    name: 'Visningen',
    contactId: 'nina_solberg',
    category: 'OKONOMI',
    minLevel: 3,
    briefing:
      'Nina ser på bunken med kontanter i hånden din og rynker på nesen. «Ingen selger noe til en mann med en pose penger. Sett fem tusen inn på konto, så snakker vi som folk.»',
    debriefing:
      '«Se der. Nå finnes du på papiret.» Hun rekker deg et kort. «Det er verdt mer enn du aner.»',
    requirements: { minTrust: 20 },
    objectives: [{ kind: 'INNSKUDD', amount: 5000 }],
    rewards: {
      cash: 600,
      xp: 45,
      trust: 5,
      heatChange: 0,
      information: null,
    },
    requiresMissions: [],
    unlocks: { missionIds: [], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },

  /* ---------------- Nivå 4-6 ---------------- */
  {
    id: 'marius_bilen',
    name: 'Bilen til Industrien',
    contactId: 'marius_mekken',
    category: 'TRANSPORT',
    minLevel: 4,
    briefing:
      'Marius banker på panseret. «Den kan ikke bli stående her. Kjør den opp til Industrien og møt meg der - jeg vil se den med egne øyne.»',
    debriefing:
      '«Du kjørte pent også.» Han tørker fingrene. «Neste gang blir det noe større.»',
    requirements: { minTrust: 20, ownsVehicle: true },
    objectives: [
      { kind: 'KJOR', districtId: 'industrien', count: 1 },
      { kind: 'EIE_KJORETOY', districtId: 'industrien' },
      { kind: 'VAER_I', districtId: 'industrien' },
    ],
    rewards: {
      cash: 2000,
      xp: 80,
      trust: 5,
      heatChange: 0,
      information: null,
    },
    requiresMissions: ['gunnar_lykta'],
    unlocks: { missionIds: ['elin_verkstedet'], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'oskar_laset',
    name: 'Låset i bakgården',
    contactId: 'oskar_lind',
    category: 'GATE',
    minLevel: 5,
    briefing:
      'Oskar veier låseverktøyet i hånden. «Kråka sier du er tålmodig. Det finner vi ut av. Bakgården i tredje - ta med ordentlig verktøy, ellers står du der som en idiot.»',
    debriefing:
      '«Du brøt ikke noe. Du åpnet det.» Han ser nesten fornøyd ut. «Presten spør etter folk som deg.»',
    requirements: { minTrust: 30, ownsAssetTypeId: 'laseverktoy' },
    objectives: [
      { kind: 'KRIM', crimeId: 'innbrudd', districtId: 'blokkene', count: 1 },
      { kind: 'BAER', assetTypeId: 'laseverktoy' },
    ],
    rewards: {
      cash: 3500,
      xp: 100,
      trust: 6,
      heatChange: 0,
      information: null,
    },
    requiresMissions: ['kraka_butikken'],
    unlocks: { missionIds: [], contactIds: ['presten'] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'amir_leveransen',
    name: 'Leveransen',
    contactId: 'amir_khan',
    category: 'TRANSPORT',
    minLevel: 5,
    briefing:
      'Amir skyver en pakke over bordet uten å slippe den. «Dette skal til Neon, og det skal dit i baksetet på noe med hjul. Ta med noe av verdi selv også - man kommer ikke tomhendt.»',
    debriefing:
      '«Riktig sted, riktig kveld, ingen spørsmål.» Amir teller opp. «Du får høre fra meg.»',
    requirements: { minTrust: 30, ownsVehicle: true },
    objectives: [
      { kind: 'KJOR', districtId: 'neon', count: 1 },
      { kind: 'VERDI_BAERES', minValue: 10000 },
      { kind: 'VAER_I', districtId: 'neon' },
    ],
    rewards: {
      cash: 4000,
      xp: 110,
      trust: 6,
      heatChange: 0,
      information: null,
    },
    requiresMissions: ['mette_ryktet'],
    unlocks: { missionIds: [], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'tommy_neonlysene',
    name: 'Under neonlysene',
    contactId: 'tommy_ravn',
    category: 'ETTERRETNING',
    minLevel: 5,
    briefing:
      'Tommy roper over musikken. «Vaktholdet her endrer seg hver uke og ingen skriver det ned. Gå tre runder og kom tilbake når du vet hvordan de står i kveld.»',
    debriefing:
      '«Det der er ferskvare.» Tommy noterer på baksiden av en serviett. «Kom igjen om noen timer, så trenger jeg det på nytt.»',
    requirements: { minTrust: 30 },
    objectives: [
      { kind: 'UTFORSK', districtId: 'neon', count: 3 },
      { kind: 'KUNNSKAP', relevance: 'SIKKERHET', districtId: 'neon' },
    ],
    rewards: {
      cash: 2200,
      xp: 90,
      trust: 4,
      heatChange: 0,
      information: null,
    },
    requiresMissions: [],
    unlocks: { missionIds: [], contactIds: [] },
    repeatable: true,
    repeatCooldownSeconds: MISSION_TUNING.defaultRepeatCooldownSeconds,
    expiresInSeconds: null,
  },
  {
    id: 'rune_lageret',
    name: 'Lageret i Industrien',
    contactId: 'rune_bakken',
    category: 'GATE',
    minLevel: 6,
    briefing:
      'Rune ruller ut en tegning. «To bygg, samme nattevakt, én runde mellom dem. Rekker du begge før skiftet snur, er det verdt noe. Ta med kassa - ikke en skrutrekker i lomma.»',
    debriefing:
      '«Begge to.» Rune ruller sammen tegningen. «Du får være med neste gang også.»',
    requirements: { minTrust: 40, ownsAssetTypeId: 'verktoykasse' },
    objectives: [
      { kind: 'KRIM', crimeId: 'innbrudd', districtId: 'industrien', count: 2 },
      { kind: 'BAER', assetTypeId: 'verktoykasse' },
    ],
    rewards: {
      cash: 6000,
      xp: 130,
      trust: 6,
      heatChange: 0,
      information: null,
    },
    requiresMissions: [],
    unlocks: { missionIds: [], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: MISSION_TUNING.defaultExpirySeconds,
  },
  {
    id: 'karin_dossieret',
    name: 'Dossieret',
    contactId: 'karin_five',
    category: 'DISKRESJON',
    minLevel: 6,
    briefing:
      'Karin snakker mens hun ser rett fram. «Det ligger en mappe med ditt navn i. Skaff meg noe ferskt om hvem som patruljerer Blokkene, og snakk med meg to ganger - én gang er en tilfeldighet.»',
    debriefing:
      '«Mappen er tynnere nå.» Hun går før du rekker å svare. Skuldrene dine kjennes lettere.',
    requirements: { minTrust: 40, maxHeat: 25 },
    objectives: [
      { kind: 'PRAT', contactId: 'karin_five', count: 2 },
      { kind: 'KUNNSKAP', relevance: 'POLITI', districtId: 'blokkene' },
      { kind: 'VAER_I', districtId: 'blokkene' },
    ],
    rewards: {
      cash: 5000,
      xp: 120,
      trust: 7,
      heatChange: -15,
      information: null,
    },
    requiresMissions: ['sara_advarselen'],
    unlocks: { missionIds: ['jonas_siste_ordet'], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },

  /* ---------------- Nivå 7-10 ---------------- */
  {
    id: 'presten_avtalen',
    name: 'Avtalen',
    contactId: 'presten',
    category: 'OKONOMI',
    minLevel: 7,
    briefing:
      'Presten snakker sakte. «Jeg gjør ikke avtaler med folk som lever fra dag til dag. Vis meg tjuefem tusen på konto og noe som går rundt av seg selv, så har vi noe å snakke om.»',
    debriefing:
      '«Da er du ikke lenger en gutt med en pose penger.» Han rekker deg hånden. «Velkommen.»',
    requirements: { minTrust: 50 },
    objectives: [
      { kind: 'BANK', amount: 25000 },
      { kind: 'EIE_VIRKSOMHET', count: 1 },
    ],
    rewards: {
      cash: 9000,
      xp: 110,
      trust: 7,
      heatChange: 0,
      information: null,
    },
    requiresMissions: ['oskar_laset'],
    unlocks: { missionIds: [], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'elin_verkstedet',
    name: 'Verkstedet i Industrien',
    contactId: 'elin_haug',
    category: 'TRANSPORT',
    minLevel: 7,
    briefing:
      'Elin slår på panseret. «Marius sier du kan kjøre. Da vil jeg se noe ordentlig - sedan eller bedre, og i stand til å kjøre, ikke et vrak du dyttet hit.»',
    debriefing:
      '«Sytti prosent og oppover. Du steller pent med den.» Hun noterer noe i en bok. «Det er ikke alle som gjør det.»',
    requirements: {
      minTrust: 50,
      ownsVehicle: true,
      minSkill: { skillId: 'mobilitet', level: 3 },
    },
    objectives: [
      {
        kind: 'EIE_KJORETOY',
        vehicleTypeIds: ['sedan', 'sportsbil'],
        districtId: 'industrien',
        minCondition: 70,
      },
      { kind: 'VAER_I', districtId: 'industrien' },
    ],
    rewards: {
      cash: 12000,
      xp: 130,
      trust: 6,
      heatChange: 0,
      information: null,
    },
    requiresMissions: ['marius_bilen'],
    unlocks: { missionIds: [], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'lise_natten',
    name: 'Låst natt',
    contactId: 'lise_moen',
    category: 'GATE',
    minLevel: 8,
    briefing:
      'Lise tenner en sigarett og lar den brenne. «Én bil, én natt, ett vindu. Du trenger proft verktøy og du trenger å vite hvor vaktene står. Gjett du, så ender du i en celle.»',
    debriefing:
      '«Inn og ut.» Hun ser på klokken. «Ni minutter. Du er brukbar.»',
    requirements: { minTrust: 50, ownsAssetTypeId: 'profesjonelt-verktoy' },
    objectives: [
      { kind: 'KRIM', crimeId: 'bilkapring', districtId: 'neon', count: 1 },
      { kind: 'BAER', assetTypeId: 'profesjonelt-verktoy' },
      { kind: 'KUNNSKAP', relevance: 'SIKKERHET', districtId: 'neon' },
    ],
    rewards: {
      cash: 18000,
      xp: 150,
      trust: 7,
      heatChange: 0,
      information: null,
    },
    requiresMissions: [],
    unlocks: { missionIds: [], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: MISSION_TUNING.defaultExpirySeconds,
  },
  {
    id: 'hanne_nokkelen',
    name: 'Nøkkelen til Neon',
    contactId: 'hanne_ruud',
    category: 'OKONOMI',
    minLevel: 8,
    briefing:
      'Hanne legger nøkkelknippet på bordet uten å slippe det. «Alle vil bo her. Nesten ingen får lov. Skaff deg en adresse i Neon, så skal jeg vise deg hvorfor det er verdt det.»',
    debriefing:
      '«Nå har du en dør her.» Hun slipper knippet. «Det betyr mer i denne byen enn penger.»',
    requirements: { minTrust: 60 },
    objectives: [
      { kind: 'EIE_EIENDOM', count: 1, districtId: 'neon' },
      { kind: 'VAER_I', districtId: 'neon' },
    ],
    rewards: {
      cash: 22000,
      xp: 160,
      trust: 6,
      heatChange: 0,
      information: null,
    },
    requiresMissions: [],
    unlocks: { missionIds: [], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: null,
  },
  {
    id: 'bendik_kjeden',
    name: 'Kjeden',
    contactId: 'bendik_aas',
    category: 'ANSKAFFELSE',
    minLevel: 9,
    briefing:
      'Bendik ser på deg over brillekanten. «Jeg kjøper ikke enkeltting lenger. Kom hit med varer for hundre tusen, og vis meg at du har to steder pengene kan komme fra. Da har vi en kjede.»',
    debriefing:
      '«Alt sammen ekte.» Han lukker kofferten. «Kom tilbake når du har mer. Det gjør du.»',
    requirements: {
      minTrust: 60,
      ownsBusinessCount: 2,
      minSkill: { skillId: 'forretning', level: 4 },
    },
    objectives: [
      { kind: 'VERDI_BAERES', minValue: 100000 },
      { kind: 'EIE_VIRKSOMHET', count: 2 },
      { kind: 'VAER_I', districtId: 'industrien' },
    ],
    rewards: {
      cash: 30000,
      xp: 180,
      trust: 7,
      heatChange: 0,
      information: null,
    },
    requiresMissions: [],
    unlocks: { missionIds: [], contactIds: [] },
    repeatable: true,
    repeatCooldownSeconds: MISSION_TUNING.defaultRepeatCooldownSeconds,
    expiresInSeconds: null,
  },
  {
    id: 'jonas_siste_ordet',
    name: 'Siste ordet',
    contactId: 'jonas_stray',
    category: 'DISKRESJON',
    minLevel: 10,
    briefing:
      'Jonas møter deg i en garasje under Regjeringskvartalet. «Én bil, herfra, i kveld. Og du går ut herfra like ren som du kom inn - ellers finnes ikke denne samtalen. Sara og Karin gikk god for deg. Ikke få meg til å angre.»',
    debriefing:
      '«Ingen rapport. Ingen navn.» Jonas gir deg en konvolutt og en adresse. «Herfra og ut bestemmer du selv hvem du er.»',
    requirements: { minTrust: 70, maxHeat: 15 },
    objectives: [
      { kind: 'KRIM', crimeId: 'bilkapring', districtId: 'regjeringskvartalet', count: 1 },
      { kind: 'HEAT_UNDER', maxHeat: 15 },
      { kind: 'VAER_I', districtId: 'regjeringskvartalet' },
    ],
    rewards: {
      cash: 40000,
      xp: 220,
      trust: 8,
      heatChange: 0,
      information: { relevance: 'MULIGHET', districtId: 'regjeringskvartalet' },
    },
    requiresMissions: ['sara_advarselen', 'karin_dossieret'],
    unlocks: { missionIds: [], contactIds: [] },
    repeatable: false,
    repeatCooldownSeconds: null,
    expiresInSeconds: MISSION_TUNING.defaultExpirySeconds,
  },
];

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

export const MISSION_IDS: readonly string[] = MISSIONS.map((mission) => mission.id);

export function findMission(id: string): MissionDefinition | undefined {
  return MISSIONS.find((mission) => mission.id === id);
}

export function isMissionId(id: string): boolean {
  return MISSION_IDS.includes(id);
}

/** Every mission a given person hands out, in level order. */
export function missionsForContact(contactId: string): MissionDefinition[] {
  return MISSIONS.filter((mission) => mission.contactId === contactId).sort(
    (a, b) => a.minLevel - b.minLevel,
  );
}

/** Missions that open once `missionId` is finished. */
export function missionsUnlockedBy(missionId: string): MissionDefinition[] {
  return MISSIONS.filter((mission) => mission.requiresMissions.includes(missionId));
}

/**
 * Whether a mission is the opening move of a chain.
 *
 * Chain openers are always visible once the player knows the person; later
 * links stay hidden until their predecessor is done, so a chain reveals itself
 * rather than showing its whole length up front.
 */
export function isChainOpener(mission: MissionDefinition): boolean {
  return mission.requiresMissions.length === 0;
}

/* ------------------------------------------------------------------ *
 * Norwegian descriptions
 * ------------------------------------------------------------------ */

const RELEVANCE_TEXT: Record<InformationRelevance, string> = {
  POLITI: 'politiet',
  AKTIVITET: 'aktiviteten',
  SIKKERHET: 'vaktholdet',
  LAGER: 'lagrene',
  TRANSPORT: 'transporten',
  MULIGHET: 'mulighetene',
};

function inDistrict(districtId: string | undefined, districtName: string | null): string {
  if (!districtId) return '';
  return districtName ? ` i ${districtName}` : ` i ${districtId}`;
}

function times(count: number): string {
  return count === 1 ? '' : ` ${count} ganger`;
}

/**
 * One line of Norwegian describing what an objective wants.
 *
 * Generated rather than written per mission, so the wording cannot drift
 * between the eighteen entries and a nineteenth cannot forget to explain
 * itself. `names` supplies the display names the catalogue does not carry -
 * district, crime, contact and asset names - so this file stays free of
 * lookups into the other catalogues.
 */
export interface ObjectiveNames {
  district?: string | null;
  crime?: string | null;
  contact?: string | null;
  asset?: string | null;
}

export function describeObjective(
  objective: MissionObjective,
  names: ObjectiveNames = {},
): string {
  const district = names.district ?? null;

  switch (objective.kind) {
    case 'KRIM': {
      const crime = (names.crime ?? objective.crimeId).toLowerCase();
      const where = inDistrict(objective.districtId, district);
      // Phrased around "forsøk" so the crime noun stays singular: Norwegian
      // plurals and genders differ per crime (et innbrudd, en bilkapring), and
      // the catalogue should not have to carry a grammar table.
      return objective.count === 1
        ? `Gjennomfør vellykket ${crime}${where}`
        : `Gjennomfør ${objective.count} vellykkede forsøk på ${crime}${where}`;
    }
    case 'UTFORSK': {
      // "Utforsk Havna", not "Utforsk i Havna": you explore the place itself.
      const where = objective.districtId
        ? ` ${district ?? objective.districtId}`
        : ' byen';
      const what = objective.relevance
        ? ` og finn noe om ${RELEVANCE_TEXT[objective.relevance]}`
        : '';
      return `Utforsk${where}${times(objective.count)}${what}`;
    }
    case 'PRAT':
      return `Snakk med ${names.contact ?? objective.contactId}${times(objective.count)}`;
    case 'KJOR':
      return `Kjør et kjøretøy til ${district ?? objective.districtId}`;
    case 'INNSKUDD':
      return `Sett inn ${objective.amount} kr i banken`;
    case 'BAER':
      return `Bær ${(names.asset ?? objective.assetTypeId).toLowerCase()}`;
    case 'VERDI_BAERES':
      return `Bær verdisaker for minst ${objective.minValue} kr`;
    case 'EIE_KJORETOY': {
      const where = inDistrict(objective.districtId, district);
      const condition = objective.minCondition
        ? ` i tilstand ${objective.minCondition} eller bedre`
        : '';
      const type = objective.vehicleTypeIds?.length
        ? `Eie ${objective.vehicleTypeIds.join(' eller ')}`
        : 'Eie et kjøretøy';
      return `${type}${where}${condition}`;
    }
    case 'EIE_VIRKSOMHET': {
      const noun = objective.count === 1 ? 'én virksomhet' : `${objective.count} virksomheter`;
      return `Eie ${noun}${inDistrict(objective.districtId, district)}`;
    }
    case 'EIE_EIENDOM': {
      const noun = objective.count === 1 ? 'én eiendom' : `${objective.count} eiendommer`;
      return `Eie ${noun}${inDistrict(objective.districtId, district)}`;
    }
    case 'BANK':
      return `Ha ${objective.amount} kr på konto`;
    case 'KONTANTER':
      return `Ha ${objective.amount} kr i kontanter`;
    case 'HEAT_UNDER':
      return `Ha heat på ${objective.maxHeat} eller lavere`;
    case 'KUNNSKAP': {
      const where = objective.districtId
        ? inDistrict(objective.districtId, district)
        : ' i byen';
      return `Vit noe ferskt om ${RELEVANCE_TEXT[objective.relevance]}${where}`;
    }
    case 'VAER_I':
      return `Vær i ${district ?? objective.districtId}`;
  }
}

/* ------------------------------------------------------------------ *
 * Catalogue validation
 * ------------------------------------------------------------------ */

/** Every district an objective or reward points at, for validation. */
function districtsOf(objective: MissionObjective): string[] {
  return 'districtId' in objective && objective.districtId ? [objective.districtId] : [];
}

/**
 * Structural checks on the catalogue, run by the test suite.
 *
 * A broken entry here would surface as a mission nobody can finish, which is
 * exactly the kind of failure that hides until a player hits it. Cheaper to
 * catch at build time.
 */
export function validateMissionCatalogue(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const mission of MISSIONS) {
    const where = `Oppdrag "${mission.id}"`;

    if (seen.has(mission.id)) problems.push(`${where}: duplisert id.`);
    seen.add(mission.id);

    if (!isContactId(mission.contactId)) {
      problems.push(`${where}: ukjent kontakt "${mission.contactId}".`);
    }
    if (mission.minLevel < 1) {
      problems.push(`${where}: minLevel må være minst 1.`);
    }
    if (!mission.briefing.trim() || !mission.debriefing.trim()) {
      problems.push(`${where}: mangler norsk tekst.`);
    }

    /* -- objectives -- */
    if (mission.objectives.length === 0) {
      problems.push(`${where}: har ingen mål.`);
    }
    if (mission.objectives.length > MISSION_TUNING.maxObjectives) {
      problems.push(
        `${where}: har ${mission.objectives.length} mål, maks er ${MISSION_TUNING.maxObjectives}.`,
      );
    }

    // The one-counter rule. Two counted actions would need a second column;
    // splitting them into a chain is the cheaper and clearer answer.
    const events = mission.objectives.filter(isEventObjective);
    if (events.length > 1) {
      problems.push(
        `${where}: har ${events.length} handlingsmål. Maks ett per oppdrag - del det i en kjede.`,
      );
    }

    for (const objective of mission.objectives) {
      for (const districtId of districtsOf(objective)) {
        if (!isDistrictId(districtId)) {
          problems.push(`${where}: ukjent distrikt "${districtId}".`);
        }
      }

      if (objectiveTarget(objective) < 1) {
        problems.push(`${where}: målet ${objective.kind} har et ugyldig antall.`);
      }

      switch (objective.kind) {
        case 'KRIM':
          if (!isCrimeId(objective.crimeId)) {
            problems.push(`${where}: ukjent kriminalitet "${objective.crimeId}".`);
          }
          break;
        case 'PRAT':
          if (!isContactId(objective.contactId)) {
            problems.push(`${where}: ukjent kontakt i mål "${objective.contactId}".`);
          }
          break;
        case 'BAER':
          if (!isAssetTypeId(objective.assetTypeId)) {
            problems.push(`${where}: ukjent eiendel "${objective.assetTypeId}".`);
          }
          break;
        case 'EIE_KJORETOY':
          for (const typeId of objective.vehicleTypeIds ?? []) {
            if (!isVehicleTypeId(typeId)) {
              problems.push(`${where}: ukjent kjøretøytype "${typeId}".`);
            }
          }
          if (
            objective.minCondition !== undefined &&
            (objective.minCondition < 0 || objective.minCondition > 100)
          ) {
            problems.push(`${where}: minCondition må være mellom 0 og 100.`);
          }
          break;
        case 'UTFORSK':
        case 'KUNNSKAP':
          if (
            objective.relevance &&
            !INFORMATION_RELEVANCE.includes(objective.relevance)
          ) {
            problems.push(`${where}: ukjent relevans "${objective.relevance}".`);
          }
          break;
        default:
          break;
      }
    }

    /* -- requirements -- */
    const { requirements } = mission;
    if (requirements.minTrust < 0 || requirements.minTrust > 100) {
      problems.push(`${where}: minTrust må være mellom 0 og 100.`);
    }
    if (requirements.ownsAssetTypeId && !isAssetTypeId(requirements.ownsAssetTypeId)) {
      problems.push(`${where}: ukjent krav-eiendel "${requirements.ownsAssetTypeId}".`);
    }
    if (requirements.minSkill) {
      if (!isSkillId(requirements.minSkill.skillId)) {
        problems.push(`${where}: ukjent ferdighet "${requirements.minSkill.skillId}".`);
      }
      if (
        requirements.minSkill.level < 1 ||
        requirements.minSkill.level > SKILL_TUNING.maxLevel
      ) {
        problems.push(
          `${where}: ferdighetsnivået må være mellom 1 og ${SKILL_TUNING.maxLevel}.`,
        );
      }
    }

    /* -- rewards -- */
    const { rewards } = mission;
    if (rewards.cash < 0) problems.push(`${where}: belønning i penger kan ikke være negativ.`);
    if (rewards.xp < 0) problems.push(`${where}: belønning i XP kan ikke være negativ.`);
    if (rewards.trust < 0) problems.push(`${where}: belønning i tillit kan ikke være negativ.`);
    if (rewards.information && !isDistrictId(rewards.information.districtId)) {
      problems.push(`${where}: ukjent distrikt i informasjonsbelønning.`);
    }

    /* -- chains -- */
    for (const required of mission.requiresMissions) {
      const parent = findMission(required);
      if (!parent) {
        problems.push(`${where}: krever ukjent oppdrag "${required}".`);
        continue;
      }
      // A link that opens below its predecessor would be unreachable in
      // practice: you would qualify for it before you could take the one
      // before it.
      if (parent.minLevel > mission.minLevel) {
        problems.push(
          `${where}: krever "${required}" som først åpner på et høyere nivå.`,
        );
      }
    }

    for (const unlocked of mission.unlocks.missionIds) {
      const target = findMission(unlocked);
      if (!target) {
        problems.push(`${where}: låser opp ukjent oppdrag "${unlocked}".`);
        continue;
      }
      // The two directions must agree, or a mission would advertise an unlock
      // the other side does not honour.
      if (!target.requiresMissions.includes(mission.id)) {
        problems.push(
          `${where}: låser opp "${unlocked}", men det oppdraget krever det ikke tilbake.`,
        );
      }
    }

    for (const contactId of mission.unlocks.contactIds) {
      if (!isContactId(contactId)) {
        problems.push(`${where}: låser opp ukjent kontakt "${contactId}".`);
      }
    }

    /* -- repetition and deadlines -- */
    if (mission.repeatable && !mission.repeatCooldownSeconds) {
      problems.push(`${where}: repeterbart oppdrag mangler avkjøling.`);
    }
    if (!mission.repeatable && mission.repeatCooldownSeconds !== null) {
      problems.push(`${where}: avkjøling er satt på et oppdrag som ikke er repeterbart.`);
    }
    if (mission.expiresInSeconds !== null && mission.expiresInSeconds < 60) {
      problems.push(`${where}: fristen er for kort til å være mulig.`);
    }
    // A chain link that can be repeated would let the rest of the chain be
    // re-triggered, so the two are kept apart.
    if (mission.repeatable && mission.unlocks.missionIds.length > 0) {
      problems.push(`${where}: et repeterbart oppdrag kan ikke låse opp andre oppdrag.`);
    }
  }

  // Chains must terminate. A cycle would be a mission that can never open.
  for (const mission of MISSIONS) {
    const visited = new Set<string>();
    const walk = (id: string): boolean => {
      if (visited.has(id)) return true;
      visited.add(id);
      const current = findMission(id);
      if (!current) return false;
      return current.requiresMissions.some(walk);
    };
    if (mission.requiresMissions.some(walk) && visited.has(mission.id)) {
      problems.push(`Oppdrag "${mission.id}": kjeden går i ring.`);
    }
  }

  return problems;
}
