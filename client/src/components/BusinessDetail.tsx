import { useEffect } from 'react';
import {
  formatDateTime,
  formatMoney,
  formatRelativeTime,
  formatSignedMoney,
} from '@skyggeby/shared';
import type { BusinessDto } from '@skyggeby/shared';
import { SegmentBar } from './BusinessCard';
import { IconBuilding, IconClose, IconMap } from './Icons';

interface BusinessDetailProps {
  business: BusinessDto;
  /** Kroner credited by the settlement that ran when this was opened. */
  earned: number;
  busy: boolean;
  onWithdraw: (businessId: string) => void;
  onClose: () => void;
}

export function BusinessDetail({
  business,
  earned,
  busy,
  onWithdraw,
  onClose,
}: BusinessDetailProps) {
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
        aria-label={business.name}
        className="panel panel-edge relative my-auto w-full max-w-lg animate-fade-up p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-violet-600/35 bg-violet-700/12 text-violet-400">
              <IconBuilding className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-2xl tracking-[0.12em] text-white">
                {business.name}
              </h2>
              <p className="label-xs mt-0.5">{business.typeName}</p>
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
          {business.districtName}
        </p>

        <div className="mt-5 border-t border-white/[0.06] pt-5">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="label-xs">Driftskonto</dt>
              <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-white">
                {formatMoney(business.cashBalance)}
              </dd>
            </div>
            <div>
              <dt className="label-xs">Opptjent siden sist</dt>
              <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-neon">
                {earned > 0 ? formatSignedMoney(earned) : '—'}
              </dd>
            </div>
            <div>
              <dt className="label-xs">Netto per dag</dt>
              <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-neon">
                {formatSignedMoney(business.netIncomePerDay)}
              </dd>
            </div>
          </dl>

          <dl className="mt-4 grid grid-cols-2 gap-4 text-xs text-steel-500">
            <div>
              <dt className="label-xs">Inntekt</dt>
              <dd className="mt-0.5 font-mono text-sm text-steel-300">
                {formatMoney(business.incomePerDay)} /dag
              </dd>
            </div>
            <div className="text-right">
              <dt className="label-xs">Driftskostnad</dt>
              <dd className="mt-0.5 font-mono text-sm text-steel-300">
                {formatMoney(business.operatingCostPerDay)} /dag
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-5">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="label-xs">Tilstand</span>
              <span className="font-mono text-xs text-steel-400">{business.condition} %</span>
            </div>
            <div className="mt-1.5">
              <SegmentBar value={business.condition} tone="green" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="label-xs">Aktivitet</span>
              <span className="font-mono text-xs text-steel-400">{business.activity} %</span>
            </div>
            <div className="mt-1.5">
              <SegmentBar value={business.activity} tone="violet" />
            </div>
          </div>
          <dl className="flex items-center justify-between gap-3 pt-1">
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
        </div>

        <div className="mt-5 border-t border-white/[0.06] pt-5">
          <p className="text-xs text-steel-500">
            Sist oppgjør {formatRelativeTime(business.lastSettlementAt)} · kjøpt{' '}
            {formatDateTime(business.purchasedAt)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onWithdraw(business.id)}
          disabled={business.cashBalance <= 0 || busy}
          className={`btn mt-5 w-full ${
            business.cashBalance > 0
              ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow hover:from-blood-500 hover:to-blood-400'
              : 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
          }`}
        >
          {busy ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Henter ut ...
            </>
          ) : business.cashBalance > 0 ? (
            `Hent ut ${formatMoney(business.cashBalance)}`
          ) : (
            'Ingenting å hente ut ennå'
          )}
        </button>
      </div>
    </div>
  );
}
