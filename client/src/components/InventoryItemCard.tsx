import type { InventoryItemDto } from '@skyggeby/shared';
import { IconBank, IconBolt, IconChevron, IconShield } from './Icons';

interface InventoryItemCardProps {
  item: InventoryItemDto;
  /** Which side of the page the card is on. */
  mode: 'carried' | 'stored';
  busy: boolean;
  anyBusy: boolean;
  onAdd: (assetId: string) => void;
  onRemove: (assetId: string) => void;
  delay: number;
}

const CATEGORY_TONE: Record<string, string> = {
  EQUIPMENT: 'border-steel-500/40 bg-white/[0.03] text-steel-300',
  TECHNOLOGY: 'border-emerald-500/35 bg-emerald-600/10 text-neon',
  VALUABLE: 'border-amber/40 bg-amber/10 text-amber',
  VEHICLE: 'border-violet-500/40 bg-violet-700/15 text-violet-400',
};

const CATEGORY_ICONS: Record<string, typeof IconShield> = {
  EQUIPMENT: IconShield,
  TECHNOLOGY: IconBolt,
  VALUABLE: IconBank,
  VEHICLE: IconChevron,
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-xs">{label}</dt>
      <dd className="mt-0.5 text-sm text-steel-300">{value}</dd>
    </div>
  );
}

export function InventoryItemCard({
  item,
  mode,
  busy,
  anyBusy,
  onAdd,
  onRemove,
  delay,
}: InventoryItemCardProps) {
  const Icon = CATEGORY_ICONS[item.category] ?? IconShield;
  const disabled = mode === 'stored' ? !item.canAdd || anyBusy : anyBusy;

  return (
    <article
      className={`panel animate-fade-up p-5 transition ${
        mode === 'stored' && !item.canAdd ? 'opacity-70' : 'hover:border-white/[0.14]'
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border
              ${CATEGORY_TONE[item.category] ?? CATEGORY_TONE.EQUIPMENT}`}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-base tracking-[0.12em] text-white">
              {item.name.toUpperCase()}
            </h3>
            <p className="label-xs mt-0.5">{item.categoryLabel}</p>
          </div>
        </div>

        <span className="shrink-0 rounded-md border border-white/[0.08] px-2 py-1 font-mono text-xs text-steel-300">
          {item.inventorySlots} {item.inventorySlots === 1 ? 'plass' : 'plasser'}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.05] pt-3">
        <Field label="Tilstand" value={`${item.condition} %`} />
        <Field label="Sted" value={item.locationName} />
        <Field label="Status" value={item.statusLabel} />
        <Field label="Synlighet" value={String(item.visibility)} />
      </dl>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => (mode === 'stored' ? onAdd(item.id) : onRemove(item.id))}
          disabled={disabled}
          className={`btn w-full py-2.5 text-xs ${
            mode === 'stored'
              ? item.canAdd
                ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow hover:from-blood-500 hover:to-blood-400'
                : 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
              : 'border border-violet-600/40 bg-violet-700/15 text-violet-400 hover:border-violet-500/70 hover:bg-violet-700/25'
          }`}
        >
          {busy ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {mode === 'stored' ? 'Legger inn ...' : 'Tar ut ...'}
            </>
          ) : mode === 'stored' ? (
            'Legg i inventar'
          ) : (
            'Ta ut'
          )}
        </button>

        {mode === 'stored' && item.blockedText && (
          <p className="mt-2 text-center text-xs text-steel-500">{item.blockedText}</p>
        )}
      </div>
    </article>
  );
}
