import { useEffect } from 'react';
import { formatDateTime, formatMoney, formatNumber } from '@skyggeby/shared';
import type { PropertyDto } from '@skyggeby/shared';
import { IconClose, IconHome, IconMap } from './Icons';
import { Meter } from './Meter';

interface PropertyDetailProps {
  property: PropertyDto;
  busy: boolean;
  onSell: (propertyId: string) => void;
  onClose: () => void;
}

/**
 * One property in full.
 *
 * The sale figure shown is the server's own `saleValue` from the payload -
 * the browser never works out what a place is worth.
 */
export function PropertyDetail({ property, busy, onSell, onClose }: PropertyDetailProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        type="button"
        aria-label="Lukk"
        onClick={onClose}
        className="fixed inset-0 animate-fade-in bg-black/75 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-label={property.name}
        className="panel panel-edge relative my-auto w-full max-w-lg animate-fade-up p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-violet-600/35 bg-violet-700/12 text-violet-400">
              <IconHome className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="break-words font-display text-2xl tracking-[0.12em] text-white">
                {property.name}
              </h2>
              <p className="label-xs mt-0.5">{property.typeName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk"
            className="rounded-lg border border-white/[0.08] p-2 text-steel-400 transition
              hover:border-white/20 hover:text-white"
          >
            <IconClose />
          </button>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-sm text-steel-400">
          <IconMap className="h-4 w-4" />
          {property.districtName}
        </p>

        {property.description && (
          <p className="mt-3 text-sm leading-relaxed text-steel-400">
            {property.description}
          </p>
        )}

        <dl className="mt-5 grid gap-4 border-t border-white/[0.06] pt-5 sm:grid-cols-2">
          <div>
            <dt className="label-xs">Kjøpspris</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-white">
              {formatMoney(property.purchasePrice)}
            </dd>
          </div>
          <div className="sm:text-right">
            <dt className="label-xs">Nåverdi</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-white">
              {formatMoney(property.currentValue)}
            </dd>
          </div>
          <div>
            <dt className="label-xs">Lagringskapasitet</dt>
            <dd className="mt-0.5 font-mono text-sm text-steel-300">
              {formatNumber(property.storageCapacity)}
            </dd>
          </div>
          <div className="sm:text-right">
            <dt className="label-xs">Sikkerhet</dt>
            <dd className="mt-0.5 text-sm text-steel-300">{property.securityLabel}</dd>
          </div>
        </dl>

        <div className="mt-5 border-t border-white/[0.06] pt-5">
          <Meter
            value={property.condition}
            max={100}
            tone="green"
            label="Tilstand"
            hint={`${property.condition} %`}
          />
          <p className="mt-3 text-xs text-steel-500">
            Kjøpt {formatDateTime(property.purchasedAt)}.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onSell(property.id)}
          disabled={busy}
          className="btn mt-5 w-full bg-gradient-to-r from-blood-600 to-blood-500 text-white
            shadow-glow hover:from-blood-500 hover:to-blood-400"
        >
          {busy ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Selger ...
            </>
          ) : (
            `Selg eiendommen for ${formatMoney(property.saleValue)}`
          )}
        </button>
      </div>
    </div>
  );
}
