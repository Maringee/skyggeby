/**
 * Contacts — the people a player knows.
 *
 * The catalogue lives here alongside districts, crimes and assets, so adding a
 * person is one entry and no migration. The database only stores the *relation*
 * between a player and a contact; who the contact is comes from this file.
 *
 * Contacts are about access, not percentages. Nothing here grants a bonus to
 * crime, information or skills, and v1 deliberately keeps it that way.
 */

import { DISTRICT_IDS, type DistrictId } from './districts';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export const CONTACT_TYPES = [
  'mekaniker',
  'politimann',
  'informant',
  'megler',
  'innbruddstyv',
  'mellommann',
] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export interface ContactTypeDefinition {
  id: ContactType;
  /** What the player calls them. */
  role: string;
  /** What this kind of person knows about, in Norwegian. */
  specialisations: string[];
  /** One line on what they are for. */
  description: string;
}

export const CONTACT_TYPE_DEFINITIONS: readonly ContactTypeDefinition[] = [
  {
    id: 'mekaniker',
    role: 'Mekaniker',
    specialisations: ['Kjøretøy', 'Havna', 'Utstyr'],
    description: 'Kan skru på det meste, og spør sjelden hvor det kom fra.',
  },
  {
    id: 'politimann',
    role: 'Politi',
    specialisations: ['Politi', 'Etterforskning', 'Hendelser'],
    description: 'Ser byen fra innsiden av systemet. Vet hva som er på gang.',
  },
  {
    id: 'informant',
    role: 'Informant',
    specialisations: ['Personer', 'Rykter', 'Hendelser'],
    description: 'Hører alt, husker det meste, og selger det til rett person.',
  },
  {
    id: 'megler',
    role: 'Megler',
    specialisations: ['Finans', 'Verdier', 'Marked'],
    description: 'Vet hva ting er verdt, og hvem som betaler for dem.',
  },
  {
    id: 'innbruddstyv',
    role: 'Innbruddstyv',
    specialisations: ['Kriminalitet', 'Utstyr', 'Bygninger'],
    description: 'Kjenner låser, alarmer og hvor folk gjør det for lett.',
  },
  {
    id: 'mellommann',
    role: 'Mellommann',
    specialisations: ['Kontakter', 'Handel', 'Informasjon'],
    description: 'Kjenner alle som er verdt å kjenne, og tar seg betalt for det.',
  },
];

const TYPE_BY_ID = new Map<string, ContactTypeDefinition>(
  CONTACT_TYPE_DEFINITIONS.map((type) => [type.id, type]),
);

export function findContactType(id: string): ContactTypeDefinition | undefined {
  return TYPE_BY_ID.get(id);
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

export const CONTACT_STATUSES = ['AVAILABLE', 'BUSY', 'UNAVAILABLE'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  AVAILABLE: 'Tilgjengelig',
  BUSY: 'Opptatt',
  UNAVAILABLE: 'Ikke tilgjengelig',
};

export const CONTACT_STATUS_BLOCK_REASONS: Record<ContactStatus, string | null> = {
  AVAILABLE: null,
  BUSY: 'Personen er opptatt akkurat nå.',
  UNAVAILABLE: 'Personen er ikke tilgjengelig.',
};

export function canContactStatus(status: ContactStatus): boolean {
  return status === 'AVAILABLE';
}

/* ------------------------------------------------------------------ *
 * Activity cost
 * ------------------------------------------------------------------ */

/**
 * What talking to people costs and gives.
 *
 * v1 made both actions free, which sounds generous but made them weightless:
 * with nothing to spend, meeting all eighteen people was a clicking exercise
 * rather than a decision. Putting them on the same energy budget as crime is
 * what turns "who do I spend my evening on" into a real question, and the
 * experience is what makes the network a route through the early levels rather
 * than a detour from them.
 */
export const CONTACT_ACTIVITY = {
  discoverEnergyCost: 2,
  discoverXp: 5,
  interactEnergyCost: 1,
  interactXp: 2,
} as const;

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

export interface ContactDefinition {
  /** Stable id. Never regenerated - the relation table points at it. */
  id: string;
  name: string;
  type: ContactType;
  /** Home district. The player does not need to be there to talk to them. */
  districtId: DistrictId;
  description: string;
  /**
   * How dependable the person is, 0-100.
   *
   * A property of the person, not of the player's relationship with them, and
   * deliberately never sent to the client. Nothing consumes it in v1; it is
   * here so a later information mechanic has one definition to build on.
   */
  reliability: number;
}

export const CONTACTS: readonly ContactDefinition[] = [
  /* -------------------------------- Sentrum -------------------------------- */
  {
    id: 'sara_viken',
    name: 'Sara Viken',
    type: 'politimann',
    districtId: 'sentrum',
    description:
      'Etterforsker i Sentrum. Snakker rolig, spør presist, og glemmer ingenting.',
    reliability: 74,
  },
  {
    id: 'nina_solberg',
    name: 'Nina Solberg',
    type: 'megler',
    districtId: 'sentrum',
    description:
      'Selger leiligheter om dagen og vurderer helt andre ting om kvelden.',
    reliability: 68,
  },
  {
    id: 'gunnar_toft',
    name: 'Gunnar Toft',
    type: 'mekaniker',
    districtId: 'sentrum',
    description:
      'Driver et verksted bak parkeringshuset. Har sett hver eneste bil i byen.',
    reliability: 81,
  },

  /* --------------------------------- Havna --------------------------------- */
  {
    id: 'marius_mekken',
    name: 'Marius «Mekken»',
    type: 'mekaniker',
    districtId: 'havna',
    description:
      'En erfaren mekaniker som holder til på Havna. Fikser alt, forklarer ingenting.',
    reliability: 82,
  },
  {
    id: 'amir_khan',
    name: 'Amir Khan',
    type: 'mellommann',
    districtId: 'havna',
    description:
      'Kjenner alle på kaia og halve byen ellers. Introduserer folk mot en tjeneste.',
    reliability: 70,
  },
  {
    id: 'mette_dal',
    name: 'Mette Dal',
    type: 'informant',
    districtId: 'havna',
    description:
      'Jobber natt på en kiosk der alle stopper. Hører mer enn hun lar seg merke med.',
    reliability: 57,
  },

  /* ------------------------------- Industrien ------------------------------ */
  {
    id: 'rune_bakken',
    name: 'Rune Bakken',
    type: 'innbruddstyv',
    districtId: 'industrien',
    description:
      'Har åpnet flere porter på industrifeltet enn vaktselskapet har nøkler til.',
    reliability: 63,
  },
  {
    id: 'elin_haug',
    name: 'Elin Haug',
    type: 'mekaniker',
    districtId: 'industrien',
    description:
      'Sveiser, skjærer og bygger om. Tar bare kontant, og bare på ettermiddagen.',
    reliability: 77,
  },
  {
    id: 'bendik_aas',
    name: 'Bendik Ås',
    type: 'mellommann',
    districtId: 'industrien',
    description:
      'Formidler avtaler mellom folk som helst ikke vil møte hverandre.',
    reliability: 61,
  },

  /* ---------------------------------- Neon --------------------------------- */
  {
    id: 'tommy_ravn',
    name: 'Tommy Ravn',
    type: 'informant',
    districtId: 'neon',
    description:
      'Står i køen utenfor utestedene og vet hvem som kom inn og hvem som ikke gjorde det.',
    reliability: 52,
  },
  {
    id: 'lise_moen',
    name: 'Lise Moen',
    type: 'innbruddstyv',
    districtId: 'neon',
    description:
      'Går inn hovedinngangen i finkjole og ut bakdøra med noe hun ikke kom med.',
    reliability: 69,
  },
  {
    id: 'hanne_ruud',
    name: 'Hanne Ruud',
    type: 'megler',
    districtId: 'neon',
    description:
      'Verdsetter alt fra klokker til kunst. Sier prisen én gang, og mener den.',
    reliability: 86,
  },

  /* -------------------------------- Blokkene ------------------------------- */
  {
    id: 'kraka',
    name: '«Kråka»',
    type: 'informant',
    districtId: 'blokkene',
    description:
      'Sitter alltid i samme bakgård. Ingen vet hva han heter, alle vet hvor han er.',
    reliability: 44,
  },
  {
    id: 'presten',
    name: '«Presten»',
    type: 'mellommann',
    districtId: 'blokkene',
    description:
      'Snakker lavt og løser konflikter uten at noen trenger å heve stemmen.',
    reliability: 79,
  },
  {
    id: 'oskar_lind',
    name: 'Oskar Lind',
    type: 'innbruddstyv',
    districtId: 'blokkene',
    description:
      'Vokste opp i høyblokkene og kjenner hver eneste kjellerbod i dem.',
    reliability: 58,
  },
  {
    id: 'karin_five',
    name: 'Karin Five',
    type: 'politimann',
    districtId: 'blokkene',
    description:
      'Nærpolitiet i Blokkene. Kjenner folk ved fornavn og velger sine kamper.',
    reliability: 72,
  },

  /* -------------------------- Regjeringskvartalet -------------------------- */
  {
    id: 'viktor_dahl',
    name: 'Viktor Dahl',
    type: 'megler',
    districtId: 'regjeringskvartalet',
    description:
      'Rådgiver med kontor bak sperringene. Vet hvilke penger som er rene.',
    reliability: 88,
  },
  {
    id: 'jonas_stray',
    name: 'Jonas Stray',
    type: 'politimann',
    districtId: 'regjeringskvartalet',
    description:
      'Sitter tett på det som avgjøres. Sier lite, men det han sier stemmer.',
    reliability: 91,
  },
];

const CONTACT_BY_ID = new Map<string, ContactDefinition>(
  CONTACTS.map((contact) => [contact.id, contact]),
);

export function findContact(id: string): ContactDefinition | undefined {
  return CONTACT_BY_ID.get(id);
}

export function isContactId(id: string): boolean {
  return CONTACT_BY_ID.has(id);
}

export const CONTACT_IDS: readonly string[] = CONTACTS.map((contact) => contact.id);

export function contactsInDistrict(districtId: string): ContactDefinition[] {
  return CONTACTS.filter((contact) => contact.districtId === districtId);
}

/* ------------------------------------------------------------------ *
 * Trust
 * ------------------------------------------------------------------ */

export const TRUST_TUNING = {
  min: 0,
  max: 100,
  /** Trust a brand new contact starts at. */
  start: 10,
  /** What one ordinary interaction is worth. */
  perInteraction: 1,
} as const;

export interface TrustLevel {
  /** Lowest trust in this band. */
  from: number;
  to: number;
  label: string;
  /** How the relationship reads, in Norwegian. */
  description: string;
}

export const TRUST_LEVELS: readonly TrustLevel[] = [
  { from: 0, to: 19, label: 'Ukjent', description: 'Dere har knapt snakket sammen.' },
  { from: 20, to: 39, label: 'Bekjent', description: 'Personen vet hvem du er.' },
  { from: 40, to: 59, label: 'Kontakt', description: 'Dere har et fungerende forhold.' },
  { from: 60, to: 79, label: 'Betrodd', description: 'Personen stoler på deg.' },
  { from: 80, to: 100, label: 'Nær kontakt', description: 'Dere står hverandre nær.' },
];

export function clampTrust(trust: number): number {
  return Math.round(
    Math.min(TRUST_TUNING.max, Math.max(TRUST_TUNING.min, Math.trunc(trust))),
  );
}

/**
 * The one place trust changes.
 *
 * Every caller goes through this rather than adding its own arithmetic, so the
 * bounds hold no matter which system moves a relationship later.
 */
export function adjustTrust(current: number, delta: number): number {
  return clampTrust(clampTrust(current) + Math.trunc(delta));
}

export function trustLevel(trust: number): TrustLevel {
  const value = clampTrust(trust);
  return (
    TRUST_LEVELS.find((level) => value >= level.from && value <= level.to) ??
    TRUST_LEVELS[0]!
  );
}

export function trustLabel(trust: number): string {
  return trustLevel(trust).label;
}

/* ------------------------------------------------------------------ *
 * Catalogue validation
 * ------------------------------------------------------------------ */

/**
 * Checks the catalogue holds together. Returns the problems it finds, so tests
 * can assert on an empty list rather than on a thrown error.
 */
export function validateContactCatalogue(): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const contact of CONTACTS) {
    if (seenIds.has(contact.id)) problems.push(`Duplikat id: ${contact.id}`);
    seenIds.add(contact.id);

    if (seenNames.has(contact.name)) problems.push(`Duplikat navn: ${contact.name}`);
    seenNames.add(contact.name);

    if (!findContactType(contact.type)) {
      problems.push(`${contact.id}: ukjent type ${contact.type}`);
    }
    if (!(DISTRICT_IDS as readonly string[]).includes(contact.districtId)) {
      problems.push(`${contact.id}: ukjent distrikt ${contact.districtId}`);
    }
    if (contact.reliability < 0 || contact.reliability > 100) {
      problems.push(`${contact.id}: pålitelighet utenfor 0-100`);
    }
    if (contact.name.trim().length < 3) problems.push(`${contact.id}: for kort navn`);
    if (contact.description.trim().length < 15) {
      problems.push(`${contact.id}: for kort beskrivelse`);
    }
  }

  return problems;
}
