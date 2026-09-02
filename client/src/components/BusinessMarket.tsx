import { useEffect, useState } from 'react';
import { BUSINESS_TUNING, formatMoney, formatSignedMoney } from '@skyggeby/shared';
import type { BusinessCatalogEntryDto } from '@skyggeby/shared';
import { IconClose, IconMap } from './Icons';

interface BusinessMarketProps {
  catalog: BusinessCatalogEntryDto[];
  loading: boolean;
  /** How many the player already owns, as counted by the server. */
  owned: number;
  maxBusinesses: number;
  buying: boolean;
  error: string | null;
  onBuy: (businessTypeId: string, name: string) => void;
  onClose: () => void;
}

/**
 * The market, and the naming dialog that follows a choice.
 *
 * The browser never sends a price: picking an entry sends its id and the name
 * the player typed, and the server reads everything else from its catalogue.
 */
export function BusinessMarket({
  catalog,
  loading,
  owned,
  maxBusinesses,
  buying,
  error,
  onBuy,
  onClose,
}: BusinessMarketProps) {
  const [chosen, setChosen] = useState<BusinessCatalogEntryDto | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (chosen) setChosen(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chosen, onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const maxReached = owned >= maxBusinesses;
  const trimmed = name.trim();
  const nameValid =
    trimmed.length >= BUSINESS_TUNING.minNameLength &&
    trimmed.length <= BUSINESS_TUNING.maxNameLength;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        type="button"
        aria-label="Lukk markedet"
        onClick={onClose}
        className="fixed inset-0 animate-fade-in bg-black/75 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-label={chosen ? `Kjøp ${chosen.name}` : 'Virksomhetsmarkedet'}
        className="panel panel-edge relative my-auto w-full max-w-3xl animate-fade-up p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-2xl tracking-[0.16em] text-white">
              {chosen ? `KJØP ${chosen.name.toUpperCase()}` : 'VIRKSOMHETSMARKEDET'}
            </h2>
            <p className="mt-1 text-xs text-steel-500">
              {chosen
                ? 'Prisen og lokasjonen avgjøres av serveren.'
                : 'Langsiktige investeringer. De koster å drive, og de tjener seg inn over tid.'}
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

        {maxReached && !chosen && (
          <p className="mt-4 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm text-steel-400">
            Maksimalt antall virksomheter nådd.
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-blood-600/40 bg-blood-700/10 px-4 py-3 text-sm text-blood-300">
            {error}
          </p>
        )}

        {chosen ? (
          <div className="mt-5">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="label-xs">Pris</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-white">
                  {formatMoney(chosen.purchasePrice)}
                </dd>
              </div>
              <div>
                <dt className="label-xs">Forventet netto</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-neon">
                  {formatSignedMoney(chosen.netIncomePerDay)}
                  <span className="ml-1 text-xs font-normal text-steel-500">/dag</span>
                </dd>
              </div>
              <div>
                <dt className="label-xs">Lokasjon</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-sm text-steel-300">
                  <IconMap className="h-4 w-4" />
                  {chosen.districtName}
                </dd>
              </div>
            </dl>

            <label className="mt-5 block">
              <span className="label-xs">Virksomhetsnavn</span>
              <input
                type="text"
                value={name}
                autoFocus
                maxLength={BUSINESS_TUNING.maxNameLength}
                onChange={(event) => setName(event.target.value)}
                placeholder="Hva skal den hete?"
                className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-ink-900/70 px-4 py-3
                  text-sm text-white outline-none transition placeholder:text-steel-600
                  focus:border-violet-500/60"
              />
              <span className="mt-1.5 block text-xs text-steel-500">
                {BUSINESS_TUNING.minNameLength}–{BUSINESS_TUNING.maxNameLength} tegn.
              </span>
            </label>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setChosen(null)}
                className="btn-ghost flex-1"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => onBuy(chosen.id, trimmed)}
                disabled={!nameValid || buying || !chosen.affordable}
                className="btn-primary flex-1"
              >
                {buying ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Kjøper ...
                  </>
                ) : (
                  `Kjøp for ${formatMoney(chosen.purchasePrice)}`
                )}
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse-soft rounded-xl bg-ink-850/70" />
            ))}
          </div>
        ) : (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {catalog.map((item) => (
              <li key={item.id} className="rounded-xl border border-white/[0.06] bg-ink-850/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base tracking-[0.1em] text-white">
                      {item.name}
                    </h3>
                    <p className="mt-1 font-mono text-sm text-steel-300">
                      {formatMoney(item.purchasePrice)}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-steel-400">
                    <IconMap className="h-3.5 w-3.5" />
                    {item.districtName}
                  </span>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-steel-500">
                  {item.description}
                </p>

                <p className="mt-3 font-mono text-sm font-semibold text-neon">
                  {formatSignedMoney(item.netIncomePerDay)}
                  <span className="ml-1 text-xs font-normal text-steel-500">/dag netto</span>
                </p>

                <button
                  type="button"
                  onClick={() => {
                    setChosen(item);
                    setName('');
                  }}
                  disabled={!item.affordable}
                  className={`btn mt-3 w-full py-2.5 text-xs ${
                    item.affordable
                      ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow hover:from-blood-500 hover:to-blood-400'
                      : 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
                  }`}
                >
                  {item.affordable ? 'Kjøp' : maxReached ? 'Maks nådd' : 'Ikke råd'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
