import { formatMoney, formatSignedMoney } from '@skyggeby/shared';
import type { BusinessDto } from '@skyggeby/shared';
import { IconBuilding, IconChevron, IconMap } from './Icons';

interface BusinessCardProps {
  business: BusinessDto;
  onOpen: (businessId: string) => void;
  delay: number;
}

/** Ten segments, so a rating reads as a state rather than a raw number. */
export function SegmentBar({ value, tone }: { value: number; tone: 'violet' | 'green' }) {
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * 10);
  const fill =
    tone === 'green'
      ? 'from-emerald-700 via-emerald-500 to-neon'
      : 'from-violet-700 via-violet-600 to-violet-400';

  return (
    <div className="flex gap-[3px]" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className={`h-2 flex-1 rounded-[1px] ${
            i < filled ? `bg-gradient-to-r ${fill}` : 'bg-ink-750'
          }`}
        />
      ))}
    </div>
  );
}

export function BusinessCard({ business, onOpen, delay }: BusinessCardProps) {
  return (
    <article
      className="panel animate-fade-up p-5 transition hover:border-white/[0.14]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <button
        type="button"
        onClick={() => onOpen(business.id)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-600/35 bg-violet-700/12 text-violet-400">
            <IconBuilding className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            {/* The player's own name leads; the catalogue type stays visible
                underneath it rather than being replaced by it. */}
            <h3 className="truncate font-display text-lg tracking-[0.1em] text-white">
              {business.name}
            </h3>
            <p className="label-xs mt-0.5">{business.typeName}</p>
          </div>
        </div>

        <span className="flex shrink-0 items-center gap-1 text-xs text-steel-400">
          <IconMap className="h-3.5 w-3.5" />
          {business.districtName}
        </span>
      </button>

      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-white/[0.05] pt-4">
        <div>
          <dt className="label-xs">Driftskonto</dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-white">
            {formatMoney(business.cashBalance)}
          </dd>
        </div>
        <div className="text-right">
          <dt className="label-xs">Netto</dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-neon">
            {formatSignedMoney(business.netIncomePerDay)}
            <span className="ml-1 text-xs font-normal text-steel-500">/dag</span>
          </dd>
        </div>
      </dl>

      <div className="mt-4 space-y-3">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="label-xs">Aktivitet</span>
            <span className="font-mono text-xs text-steel-400">{business.activity} %</span>
          </div>
          <div className="mt-1.5">
            <SegmentBar value={business.activity} tone="violet" />
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="label-xs">Tilstand</span>
            <span className="font-mono text-xs text-steel-400">{business.condition} %</span>
          </div>
          <div className="mt-1.5">
            <SegmentBar value={business.condition} tone="green" />
          </div>
        </div>
      </div>

      <dl className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3">
        <div>
          <dt className="label-xs">Risiko</dt>
          <dd className="mt-0.5 text-sm text-steel-300">{business.riskLabel}</dd>
        </div>
        <div className="text-right">
          <dt className="label-xs">Verdiestimat</dt>
          <dd className="mt-0.5 text-sm text-steel-300">
            {formatMoney(business.estimatedValue)}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => onOpen(business.id)}
        className="btn-ghost mt-4 w-full py-2.5 text-xs"
      >
        Administrer
        <IconChevron className="h-3.5 w-3.5" />
      </button>
    </article>
  );
}
