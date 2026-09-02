import { formatMoney, formatNumber } from '@skyggeby/shared';
import type { PropertyDto } from '@skyggeby/shared';
import { IconChevron, IconHome, IconMap, IconShield } from './Icons';
import { Meter } from './Meter';

interface PropertyCardProps {
  property: PropertyDto;
  busy: boolean;
  anyBusy: boolean;
  onOpen: (propertyId: string) => void;
  onSell: (propertyId: string) => void;
  delay: number;
}

/**
 * One owned property.
 *
 * The district shown is the property's own address, which has nothing to do
 * with where the player is standing - a place does not follow you around.
 */
export function PropertyCard({
  property,
  busy,
  anyBusy,
  onOpen,
  onSell,
  delay,
}: PropertyCardProps) {
  return (
    <article
      style={{ animationDelay: `${delay}ms` }}
      className="panel animate-fade-up p-5 transition hover:border-white/[0.14]"
    >
      <button
        type="button"
        onClick={() => onOpen(property.id)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-600/35 bg-violet-700/12 text-violet-400">
            <IconHome className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            {/* The player's own name leads; the catalogue type stays under it. */}
            <h3 className="truncate font-display text-lg tracking-[0.1em] text-white">
              {property.name}
            </h3>
            <p className="label-xs mt-0.5">{property.typeName}</p>
          </div>
        </div>

        <span className="flex shrink-0 items-center gap-1 text-xs text-steel-400">
          <IconMap className="h-3.5 w-3.5" />
          {property.districtName}
        </span>
      </button>

      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-white/[0.05] pt-4">
        <div>
          <dt className="label-xs">Verdi</dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-white">
            {formatMoney(property.currentValue)}
          </dd>
        </div>
        <div className="text-right">
          <dt className="label-xs">Lagringsplass</dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-white">
            {formatNumber(property.storageCapacity)}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <Meter
          value={property.condition}
          max={100}
          tone="green"
          label="Tilstand"
          hint={`${property.condition} %`}
        />
      </div>

      <dl className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3">
        <div>
          <dt className="label-xs flex items-center gap-1.5">
            <IconShield className="h-3.5 w-3.5" />
            Sikkerhet
          </dt>
          <dd className="mt-0.5 text-sm text-steel-300">{property.securityLabel}</dd>
        </div>
        <div className="text-right">
          <dt className="label-xs">Kjøpt for</dt>
          <dd className="mt-0.5 font-mono text-sm text-steel-300">
            {formatMoney(property.purchasePrice)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onOpen(property.id)}
          className="btn-ghost flex-1 py-2.5 text-xs"
        >
          Detaljer
          <IconChevron className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onSell(property.id)}
          disabled={anyBusy}
          className="btn-ghost px-4 py-2.5 text-xs"
        >
          {busy ? 'Selger ...' : 'Selg'}
        </button>
      </div>
    </article>
  );
}
