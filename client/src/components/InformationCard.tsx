import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FRESHNESS_DESCRIPTIONS,
  INFORMATION_TYPE_DESCRIPTIONS,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatPoints,
  formatRelativeTime,
} from '@skyggeby/shared';
import type { Freshness, InformationDto, InformationType } from '@skyggeby/shared';
import { IconChevron, IconClock, IconMap, IconTarget } from './Icons';

interface InformationCardProps {
  information: InformationDto;
  /** Ticked once a second so ageing and countdowns stay honest. */
  now: number;
  delay: number;
}

const TYPE_TONE: Record<string, string> = {
  RYKTE: 'border-steel-500/40 bg-white/[0.03] text-steel-300',
  OBSERVASJON: 'border-emerald-500/35 bg-emerald-600/10 text-neon',
  ETTERRETNING: 'border-violet-500/40 bg-violet-700/15 text-violet-400',
  KONTAKT: 'border-amber/40 bg-amber/10 text-amber',
  HEMMELIGHET: 'border-blood-600/45 bg-blood-700/15 text-blood-400',
};

const FRESHNESS_TONE: Record<string, string> = {
  FERSK: 'text-neon',
  GAMMEL: 'text-amber',
  UTDATERT: 'text-blood-400',
  UTBRUKT: 'text-steel-500',
};

function reliabilityTone(reliability: number): string {
  if (reliability >= 80) return 'from-emerald-700 via-emerald-500 to-neon';
  if (reliability >= 60) return 'from-violet-700 via-violet-600 to-violet-400';
  if (reliability >= 40) return 'from-orange-700 via-amber to-yellow-300';
  return 'from-blood-700 via-blood-600 to-blood-400';
}

export function InformationCard({ information, now, delay }: InformationCardProps) {
  const [open, setOpen] = useState(false);

  const expiresIn = information.expiresAt
    ? Math.max(0, Math.ceil((new Date(information.expiresAt).getTime() - now) / 1000))
    : null;

  const spent = information.used;
  const stale = information.freshness === 'UTDATERT';

  return (
    <article
      className={`panel group relative animate-fade-up overflow-hidden p-5 transition
        ${spent || stale ? 'opacity-60' : 'hover:border-white/[0.14]'}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`rounded-md border px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em]
            ${TYPE_TONE[information.type] ?? TYPE_TONE.RYKTE}`}
        >
          {information.typeLabel}
        </span>

        <span
          className={`shrink-0 text-[0.68rem] font-semibold uppercase tracking-[0.12em]
            ${FRESHNESS_TONE[information.freshness] ?? 'text-steel-500'}`}
        >
          {information.freshnessLabel}
        </span>
      </div>

      <h3 className="mt-3 font-display text-lg leading-tight tracking-[0.08em] text-white">
        {information.title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-steel-400">{information.content}</p>

      <dl className="mt-4 space-y-2.5 border-t border-white/[0.05] pt-3">
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 label-xs">
            <IconMap className="h-3.5 w-3.5" />
            Sted
          </dt>
          <dd className="text-sm text-steel-300">
            {information.districtName ?? 'Hele byen'}
          </dd>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5 label-xs">
              <IconTarget className="h-3.5 w-3.5" />
              Pålitelighet
            </dt>
            <dd className="font-mono text-sm font-semibold tabular-nums text-white">
              {information.reliability} %
            </dd>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-750">
            <div
              className={`h-full origin-left animate-bar-grow rounded-full bg-gradient-to-r ${reliabilityTone(
                information.reliability,
              )}`}
              style={{ width: `${information.reliability}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 label-xs">
            <IconClock className="h-3.5 w-3.5" />
            Oppdaget
          </dt>
          <dd className="text-sm text-steel-300">
            {formatRelativeTime(information.discoveredAt)}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-3">
          <dt className="label-xs">Verdi</dt>
          <dd className="font-mono text-sm text-steel-300">
            {formatMoney(information.currentValue)}
            {information.currentValue !== information.baseValue && (
              <span className="ml-1.5 text-[0.68rem] text-steel-500 line-through">
                {formatMoney(information.baseValue)}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {open && (
        <dl className="mt-3 animate-fade-in space-y-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-3">
            <dt className="label-xs">Kilde</dt>
            <dd className="text-sm text-steel-300">{information.sourceLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="label-xs">Handler om</dt>
            <dd className="text-sm text-steel-300">{information.relevanceLabel}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="label-xs">Nyttig for</dt>
            <dd className="text-right text-sm text-steel-300">
              {information.helpsWith.join(', ')}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="label-xs">Mulig fordel</dt>
            <dd className="font-mono text-sm text-steel-300">
              {information.potentialBonus > 0
                ? `+${formatPoints(information.potentialBonus)} prosentpoeng`
                : 'Ingen'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="label-xs">Går ut</dt>
            <dd className="text-sm text-steel-300">
              {expiresIn === null
                ? 'Aldri'
                : expiresIn > 0
                  ? `Om ${formatDuration(expiresIn)}`
                  : 'Har gått ut'}
            </dd>
          </div>
          {information.usedAt && (
            <div className="flex items-center justify-between gap-3">
              <dt className="label-xs">Brukt</dt>
              <dd className="text-sm text-steel-300">
                {formatDateTime(information.usedAt)}
              </dd>
            </div>
          )}
          <p className="border-t border-white/[0.05] pt-2.5 text-xs leading-relaxed text-steel-500">
            {INFORMATION_TYPE_DESCRIPTIONS[information.type as InformationType]}{' '}
            {FRESHNESS_DESCRIPTIONS[information.freshness as Freshness]}
          </p>
        </dl>
      )}

      <div className="mt-4 flex items-center gap-2">
        {spent ? (
          <span className="btn flex-1 border border-white/[0.08] bg-white/[0.02] text-steel-500">
            Brukt opp
          </span>
        ) : stale ? (
          <span className="btn flex-1 border border-white/[0.08] bg-white/[0.02] text-steel-500">
            Utdatert
          </span>
        ) : (
          <Link to="/gata" className="btn-secondary flex-1">
            Bruk på gata
            <IconChevron className="h-4 w-4" />
          </Link>
        )}

        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="btn-ghost px-4"
        >
          {open ? 'Skjul' : 'Detaljer'}
        </button>
      </div>
    </article>
  );
}
