import { useState } from 'react';
import { formatMoney, formatRelativeTime } from '@skyggeby/shared';
import type { AssetDto } from '@skyggeby/shared';
import { IconBank, IconBolt, IconMap, IconShield, IconTarget } from './Icons';

interface AssetCardProps {
  asset: AssetDto;
  busy: boolean;
  anyBusy: boolean;
  onSell: (assetId: string) => void;
  delay: number;
}

const CATEGORY_TONE: Record<string, string> = {
  VEHICLE: 'border-violet-500/40 bg-violet-700/15 text-violet-400',
  EQUIPMENT: 'border-steel-500/40 bg-white/[0.03] text-steel-300',
  TECHNOLOGY: 'border-emerald-500/35 bg-emerald-600/10 text-neon',
  VALUABLE: 'border-amber/40 bg-amber/10 text-amber',
};

const CATEGORY_ICONS: Record<string, typeof IconMap> = {
  VEHICLE: IconMap,
  EQUIPMENT: IconShield,
  TECHNOLOGY: IconBolt,
  VALUABLE: IconBank,
};

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'text-neon',
  STORED: 'text-steel-300',
  DAMAGED: 'text-amber',
  SEIZED: 'text-blood-400',
};

function conditionTone(condition: number): string {
  if (condition >= 80) return 'from-emerald-700 via-emerald-500 to-neon';
  if (condition >= 50) return 'from-violet-700 via-violet-600 to-violet-400';
  if (condition >= 25) return 'from-orange-700 via-amber to-yellow-300';
  return 'from-blood-700 via-blood-600 to-blood-400';
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-xs">{label}</dt>
      <dd className="mt-0.5 text-sm text-steel-300">{value}</dd>
    </div>
  );
}

export function AssetCard({ asset, busy, anyBusy, onSell, delay }: AssetCardProps) {
  const [confirming, setConfirming] = useState(false);
  const Icon = CATEGORY_ICONS[asset.category] ?? IconShield;

  return (
    <article
      className={`panel group relative animate-fade-up overflow-hidden p-5 transition
        ${asset.canSell ? 'hover:border-white/[0.14]' : 'opacity-70'}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border
              ${CATEGORY_TONE[asset.category] ?? CATEGORY_TONE.EQUIPMENT}`}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-lg tracking-[0.12em] text-white">
              {asset.name.toUpperCase()}
            </h3>
            <p className="label-xs mt-0.5">{asset.categoryLabel}</p>
          </div>
        </div>

        <span
          className={`shrink-0 text-[0.68rem] font-semibold uppercase tracking-[0.12em]
            ${STATUS_TONE[asset.status] ?? 'text-steel-500'}`}
        >
          {asset.statusLabel}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="label-xs">Verdi</p>
          <p className="font-mono text-xl font-semibold tabular-nums text-white">
            {formatMoney(asset.currentValue)}
          </p>
        </div>
        <div className="text-right">
          <p className="label-xs">Tilstand</p>
          <p className="font-mono text-sm font-semibold text-steel-300">
            {asset.condition} %
          </p>
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-750">
        <div
          className={`h-full origin-left animate-bar-grow rounded-full bg-gradient-to-r ${conditionTone(
            asset.condition,
          )}`}
          style={{ width: `${asset.condition}%` }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.05] pt-3">
        <Field
          label="Vedlikehold"
          value={
            asset.maintenanceCostPerDay > 0
              ? `${formatMoney(asset.maintenanceCostPerDay)}/dag`
              : 'Ingen'
          }
        />
        <Field label="Synlighet" value={`${asset.visibility} · ${asset.visibilityLabel}`} />
        <Field label="Risiko" value={`${asset.risk} · ${asset.riskLabel}`} />
        <Field label="Sted" value={asset.locationName} />
      </dl>

      <p className="mt-3 text-[0.68rem] text-steel-500">
        Kjøpt {formatRelativeTime(asset.purchasedAt)} for {formatMoney(asset.purchasePrice)}.
      </p>

      <div className="mt-4">
        {confirming ? (
          <div className="animate-fade-in rounded-lg border border-blood-600/45 bg-blood-700/12 p-3">
            <p className="text-sm text-white">Selg {asset.name.toLowerCase()}?</p>
            <dl className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-steel-400">Kjøpspris</dt>
                <dd className="font-mono text-steel-300">{formatMoney(asset.purchasePrice)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-steel-400">Estimert salgsverdi</dt>
                <dd className="font-mono font-semibold text-neon">
                  {formatMoney(asset.saleValue)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[0.68rem] text-steel-500">
              Serveren beregner endelig pris.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onSell(asset.id);
                }}
                disabled={anyBusy}
                className="btn-primary flex-1 py-2.5 text-xs"
              >
                Selg
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn-ghost flex-1 py-2.5 text-xs"
              >
                Avbryt
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!asset.canSell || anyBusy}
              className={`btn w-full ${
                asset.canSell
                  ? 'border border-violet-600/40 bg-violet-700/15 text-violet-400 hover:border-violet-500/70 hover:bg-violet-700/25'
                  : 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
              }`}
            >
              {busy ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Selger ...
                </>
              ) : (
                <>
                  <IconTarget className="h-4 w-4" />
                  Selg
                </>
              )}
            </button>
            {asset.blockedText && (
              <p className="mt-2 text-center text-xs text-steel-500">{asset.blockedText}</p>
            )}
          </>
        )}
      </div>
    </article>
  );
}
