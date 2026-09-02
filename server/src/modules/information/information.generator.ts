import {
  INFORMATION_BALANCE,
  INFORMATION_TUNING,
  INFORMATION_TYPES,
  clampReliability,
  type DistrictDefinition,
  type InformationRelevance,
  type InformationSource,
  type InformationType,
} from '@skyggeby/shared';
import { pickOne, randomChance, randomInt } from '../../lib/random';
import type { InformationDraft } from './information.types';
import { baseValueFor } from './information.value';

/**
 * Turns an exploration into a concrete piece of information.
 *
 * Everything here is decided server side: which type turns up, how reliable it
 * claims to be, whether it is actually true, and what it is worth. The client
 * contributes nothing but the request.
 */

interface Template {
  relevance: InformationRelevance;
  /** `{distrikt}` is replaced with the district name. */
  title: string;
  content: string;
}

/**
 * Written per relevance category rather than per district, so a new district
 * gets a full pool of information without anyone writing new copy.
 */
const TEMPLATES: readonly Template[] = [
  {
    relevance: 'POLITI',
    title: 'Patruljene har lagt om ruta',
    content:
      'Patruljene i {distrikt} kjører en ny runde etter midnatt. Det åpner et hull på rundt tjue minutter i den nordre enden.',
  },
  {
    relevance: 'POLITI',
    title: 'Underbemannet vakt',
    content:
      'To av de faste i {distrikt} er sykmeldt. Distriktet dekkes av innleide folk som ikke kjenner gatene.',
  },
  {
    relevance: 'POLITI',
    title: 'Sivil bil i området',
    content:
      'Det står en umerket bil parkert fast i {distrikt}. Noen følger med på noe, men det er ikke sikkert det er deg.',
  },
  {
    relevance: 'AKTIVITET',
    title: 'Folksomt utover kvelden',
    content:
      'Det er uvanlig mye folk i {distrikt} i kveld. Mye å velge i, men også mange øyne.',
  },
  {
    relevance: 'AKTIVITET',
    title: 'Kontantoppgjør i omløp',
    content:
      'Flere steder i {distrikt} tar bare kontant denne uka. Terminalene har vært nede siden mandag.',
  },
  {
    relevance: 'AKTIVITET',
    title: 'Stille periode',
    content:
      'Mellom ett og tre om natta tømmes gatene i {distrikt} nesten helt. Da ser ingen noe — og ingen hjelper deg heller.',
  },
  {
    relevance: 'SIKKERHET',
    title: 'Kamera ute av drift',
    content:
      'To kameraer i {distrikt} har stått og blinket rødt i en uke. Ingen har meldt fra.',
  },
  {
    relevance: 'SIKKERHET',
    title: 'Bakdør står ulåst',
    content:
      'En bakdør i {distrikt} blir satt på klem for røykepausene og glemmes igjen hver kveld.',
  },
  {
    relevance: 'SIKKERHET',
    title: 'Alarmen er ny og dårlig innstilt',
    content:
      'Den nye alarmen i {distrikt} går av på ingenting. Folk har sluttet å reagere på den.',
  },
  {
    relevance: 'LAGER',
    title: 'Full palle over helga',
    content:
      'Et lager i {distrikt} blir stående fullt til over helga. Ingen henter før mandag morgen.',
  },
  {
    relevance: 'LAGER',
    title: 'Vaktbua er tom om natta',
    content:
      'Vaktbua ved lageret i {distrikt} bemannes bare til midnatt. Etter det er det bare en termos igjen.',
  },
  {
    relevance: 'TRANSPORT',
    title: 'Fast leveringstidspunkt',
    content:
      'Bilene kommer til {distrikt} på samme klokkeslett hver eneste dag. Sjåføren lar motoren gå.',
  },
  {
    relevance: 'TRANSPORT',
    title: 'Nøkler blir liggende igjen',
    content:
      'I {distrikt} er det flere som lar nøkkelen ligge i bilen mens de bærer inn.',
  },
  {
    relevance: 'MULIGHET',
    title: 'Noen leter etter folk',
    content:
      'Det går ord om at noen i {distrikt} trenger hender til noe. Ingen sier hva.',
  },
  {
    relevance: 'MULIGHET',
    title: 'Et vindu som ikke varer',
    content:
      'Det har åpnet seg noe i {distrikt}. Den som er der først, får det — den som venter, får ingenting.',
  },
];

/** Weighted draw over information types. */
function pickType(): InformationType {
  const total = INFORMATION_TYPES.reduce(
    (sum, type) => sum + INFORMATION_BALANCE[type].weight,
    0,
  );

  let roll = randomInt(1, total);
  for (const type of INFORMATION_TYPES) {
    roll -= INFORMATION_BALANCE[type].weight;
    if (roll <= 0) return type;
  }
  return 'RYKTE';
}

/**
 * Whether the information is actually correct.
 *
 * Correlated with the stated reliability but never determined by it: a
 * confident-looking tip can still be wrong, which is the entire point of the
 * system. Never exposed to the client.
 */
function rollTruth(reliability: number): boolean {
  const odds =
    INFORMATION_TUNING.truthFloor + (reliability / 100) * INFORMATION_TUNING.truthSpan;
  return randomChance() < Math.min(0.97, odds);
}

/**
 * The chance an exploration turns up anything.
 *
 * District activity is the base; `skillBonus` is Etterretning's contribution,
 * already resolved by the skill system. The result is clamped either way, so
 * no skill level can make a search a certainty.
 */
export function discoveryChance(
  district: DistrictDefinition,
  skillBonus = 0,
): number {
  const raw =
    INFORMATION_TUNING.exploreBaseChance +
    (district.activity - 3) * INFORMATION_TUNING.exploreChancePerActivity +
    skillBonus;

  return Math.min(
    INFORMATION_TUNING.exploreMaxChance,
    Math.max(INFORMATION_TUNING.exploreMinChance, raw),
  );
}

/**
 * `reliabilityBonus` comes from Etterretning: a better-trained eye brings back
 * a firmer read on what it found. Still clamped to 0-100.
 */
export function generateDiscovery(
  district: DistrictDefinition,
  reliabilityBonus = 0,
): InformationDraft {
  const type = pickType();
  const balance = INFORMATION_BALANCE[type];

  const reliability = clampReliability(
    randomInt(balance.reliability.min, balance.reliability.max) +
      Math.round(reliabilityBonus),
  );

  const template = pickOne(TEMPLATES, TEMPLATES[0]!);
  const content = template.content.replace('{distrikt}', district.name);

  const expiresAt = new Date(Date.now() + balance.lifetimeMinutes * 60 * 1000);

  return {
    type,
    source: balance.defaultSource satisfies InformationSource,
    relevance: template.relevance,
    title: template.title,
    content,
    districtId: district.id,
    reliability,
    isTrue: rollTruth(reliability),
    baseValue: baseValueFor(type, reliability, district.id),
    expiresAt,
  };
}
