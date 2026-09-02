import { useEffect, useState } from 'react';
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  formatMoney,
} from '@skyggeby/shared';
import type { AssetCatalogEntryDto, AssetCategory } from '@skyggeby/shared';
import { IconClose } from './Icons';

interface AssetCatalogProps {
  catalog: AssetCatalogEntryDto[];
  loading: boolean;
  buyingId: string | null;
  anyBusy: boolean;
  onBuy: (assetTypeId: string) => void;
  onClose: () => void;
}

/** Full-screen catalogue. The client sends only an id when buying. */
export function AssetCatalog({
  catalog,
  loading,
  buyingId,
  anyBusy,
  onBuy,
  onClose,
}: AssetCatalogProps) {
  const [category, setCategory] = useState<AssetCategory | 'ALLE'>('ALLE');

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

  const visible =
    category === 'ALLE' ? catalog : catalog.filter((item) => item.category === category);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        type="button"
        aria-label="Lukk katalogen"
        onClick={onClose}
        className="fixed inset-0 animate-fade-in bg-black/75 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-label="Eiendelskatalog"
        className="panel panel-edge relative my-auto w-full max-w-4xl animate-fade-up p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl tracking-[0.16em] text-white">
              KJØP EIENDEL
            </h2>
            <p className="mt-1 text-xs text-steel-500">
              Prisen avgjøres av serveren. Eiendelen havner der du står nå.
            </p>
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

        <div className="mt-5 flex flex-wrap gap-1 rounded-lg border border-white/[0.06] bg-ink-850/60 p-1">
          {(['ALLE', ...ASSET_CATEGORIES] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                category === option
                  ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white'
                  : 'text-steel-400 hover:text-white'
              }`}
            >
              {option === 'ALLE' ? 'Alle' : ASSET_CATEGORY_LABELS[option]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse-soft rounded-xl bg-ink-850/70" />
            ))}
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {visible.map((item, index) => (
              <article
                key={item.id}
                className="animate-fade-up rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
                style={{ animationDelay: `${index * 25}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base tracking-[0.1em] text-white">
                      {item.name.toUpperCase()}
                    </h3>
                    <p className="label-xs mt-0.5">{item.categoryLabel}</p>
                  </div>
                  <p className="shrink-0 font-mono text-sm font-semibold tabular-nums text-white">
                    {formatMoney(item.purchasePrice)}
                  </p>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-steel-400">
                  {item.description}
                </p>

                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.05] pt-2.5">
                  <div>
                    <dt className="label-xs">Vedlikehold</dt>
                    <dd className="mt-0.5 font-mono text-[0.7rem] text-steel-300">
                      {item.maintenanceCostPerDay > 0
                        ? `${item.maintenanceCostPerDay} kr/d`
                        : 'Ingen'}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-xs">Synlighet</dt>
                    <dd className="mt-0.5 font-mono text-[0.7rem] text-steel-300">
                      {item.visibility}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-xs">Risiko</dt>
                    <dd className="mt-0.5 font-mono text-[0.7rem] text-steel-300">
                      {item.risk}
                    </dd>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={() => onBuy(item.id)}
                  disabled={!item.affordable || anyBusy}
                  className={`btn mt-3 w-full py-2.5 text-xs ${
                    item.affordable
                      ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow hover:from-blood-500 hover:to-blood-400'
                      : 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
                  }`}
                >
                  {buyingId === item.id ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Kjøper ...
                    </>
                  ) : item.affordable ? (
                    `Kjøp for ${formatMoney(item.purchasePrice)}`
                  ) : (
                    'Ikke råd'
                  )}
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
