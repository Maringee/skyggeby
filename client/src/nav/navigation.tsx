import type { ComponentType } from 'react';
import {
  IconBank,
  IconGrid,
  IconMail,
  IconMap,
  IconSettings,
  IconTarget,
  IconUser,
} from '@/components/Icons';

/** A page inside a category, shown as sub-navigation. */
export interface NavChild {
  to: string;
  label: string;
}

export interface NavEntry {
  /** Route path, also used as the React Router link target. */
  to: string;
  /** Category name, shown in caps in the sidebar. */
  label: string;
  /** One-line Norwegian description of what lives under the category. */
  description: string;
  icon: ComponentType<{ className?: string }>;
  /** Rendered greyed out with a "Snart"-tag until the system exists. */
  upcoming?: boolean;
  /**
   * Extra paths that belong to this category. A system can get its own route
   * without becoming a new top-level entry.
   */
  matches?: string[];
  /** Pages within the category, shown as sub-navigation when it is active. */
  children?: NavChild[];
}

/**
 * The single source of truth for the game's main navigation.
 *
 * A new system gets its own category by adding one entry here plus a route in
 * App.tsx - never by growing an existing page. A system that belongs inside an
 * existing category becomes a `children` entry instead, so the sidebar does not
 * grow a new top-level item for every feature.
 */
export const NAV_ENTRIES: NavEntry[] = [
  {
    to: '/dashbord',
    label: 'Oversikt',
    description: 'Statusen din på ett brett',
    icon: IconGrid,
  },
  {
    to: '/byen',
    label: 'Byen',
    description: 'Kart, distrikter og forflytning',
    icon: IconMap,
  },
  {
    to: '/gata',
    label: 'Gata',
    description: 'Kriminalitet, informasjon og kjøretøy',
    icon: IconTarget,
    matches: ['/informasjon', '/kjoretoy'],
    children: [
      { to: '/gata', label: 'Kriminalitet' },
      { to: '/informasjon', label: 'Informasjon' },
      { to: '/kjoretoy', label: 'Kjøretøy' },
    ],
  },
  {
    to: '/okonomi',
    label: 'Økonomi',
    description: 'Bank, eiendeler og regnskap',
    icon: IconBank,
    matches: ['/eiendeler', '/eiendom'],
    children: [
      { to: '/okonomi', label: 'Bank' },
      { to: '/eiendeler', label: 'Eiendeler' },
      { to: '/okonomi/inventar', label: 'Inventar' },
      { to: '/okonomi/virksomheter', label: 'Virksomheter' },
      { to: '/eiendom', label: 'Eiendom' },
      { to: '/okonomi/transaksjoner', label: 'Transaksjoner' },
    ],
  },
  {
    to: '/meg',
    label: 'Meg',
    description: 'Profil, ferdigheter og nettverk',
    icon: IconUser,
    // Another player's profile is still a "people" page, so it lights up Meg
    // rather than leaving the sidebar with nothing selected.
    matches: ['/spiller'],
    children: [
      { to: '/meg', label: 'Profil' },
      { to: '/meg/ferdigheter', label: 'Ferdigheter' },
      { to: '/meg/kontakter', label: 'Kontakter' },
      { to: '/meg/statistikk', label: 'Statistikk' },
    ],
  },
  {
    to: '/meldinger',
    label: 'Meldinger',
    description: 'Post fra andre spillere',
    icon: IconMail,
  },
  {
    to: '/innstillinger',
    label: 'Innstillinger',
    description: 'Konto og oppsett',
    icon: IconSettings,
  },
];

/** Every path that belongs to a category. */
function pathsFor(entry: NavEntry): string[] {
  return [entry.to, ...(entry.matches ?? []), ...(entry.children ?? []).map((c) => c.to)];
}

/** Resolves the entry matching a pathname, for page titles and highlighting. */
export function findNavEntry(pathname: string): NavEntry | undefined {
  return NAV_ENTRIES.find((entry) =>
    pathsFor(entry).some((path) => pathname === path || pathname.startsWith(`${path}/`)),
  );
}
