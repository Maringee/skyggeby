import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ASSET_CATEGORY_LABELS, CARRYABLE_CATEGORIES } from '@skyggeby/shared';
import type { AssetCategory, InventoryItemDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from '@/components/Alert';
import { SectionTabs } from '@/components/GataTabs';
import { IconChevron, IconShield } from '@/components/Icons';
import { InventoryItemCard } from '@/components/InventoryItemCard';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/state/AuthContext';

type CategoryFilter = AssetCategory | 'ALLE';

export function InventoryPage() {
  const { player } = useAuth();

  const [items, setItems] = useState<InventoryItemDto[]>([]);
  const [stored, setStored] = useState<InventoryItemDto[]>([]);
  const [usage, setUsage] = useState({ used: 0, capacity: 10, remaining: 10 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryFilter>('ALLE');

  const apply = useCallback(
    (res: {
      items: InventoryItemDto[];
      stored: InventoryItemDto[];
      usedSlots: number;
      capacity: number;
      remainingSlots: number;
    }) => {
      setItems(res.items);
      setStored(res.stored);
      setUsage({
        used: res.usedSlots,
        capacity: res.capacity,
        remaining: res.remainingSlots,
      });
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      apply(await api.inventory());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente inventaret.');
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (assetId: string, action: 'add' | 'remove') => {
    if (busyId) return;

    setBusyId(assetId);
    setError(null);
    setMessage(null);

    try {
      // Only the asset id is sent; capacity and ownership are the server's call.
      const res =
        action === 'add'
          ? await api.addToInventory(assetId)
          : await api.removeFromInventory(assetId);
      apply(res);
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Handlingen feilet. Prøv igjen.');
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const filter = (list: InventoryItemDto[]) =>
    category === 'ALLE' ? list : list.filter((item) => item.category === category);

  const visibleItems = useMemo(() => filter(items), [items, category]);
  const visibleStored = useMemo(() => filter(stored), [stored, category]);

  if (!player) return null;

  const pct = usage.capacity > 0 ? (usage.used / usage.capacity) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Økonomi"
        title="Inventar"
        intro="Eiendeler du har tilgjengelig. Å bære noe flytter det ikke — det ligger fortsatt der det er."
        aside={
          <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
            <span className="label-xs mr-2">Plasser</span>
            <span className="font-mono font-semibold text-white">
              {usage.used} / {usage.capacity}
            </span>
          </span>
        }
      />

      <SectionTabs section="/okonomi" />

      {/* Capacity */}
      <section className="panel panel-edge animate-fade-up p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-lg tracking-[0.16em] text-white">
            {usage.used} / {usage.capacity} PLASSER BRUKT
          </p>
          <p className="text-xs text-steel-500">
            {usage.remaining} {usage.remaining === 1 ? 'plass' : 'plasser'} ledig
          </p>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {Array.from({ length: usage.capacity }).map((_, i) => (
            <span
              key={i}
              className={`h-2.5 flex-1 rounded-[2px] transition-colors ${
                i < usage.used
                  ? 'bg-gradient-to-b from-blood-500 to-blood-700'
                  : 'bg-ink-750'
              }`}
            />
          ))}
        </div>
        <p className="sr-only">{Math.round(pct)} % av inventaret er i bruk.</p>
      </section>

      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {(items.length > 0 || stored.length > 0) && (
        <section className="flex flex-wrap items-center gap-2 animate-fade-in">
          <div className="flex flex-wrap gap-1 rounded-lg border border-white/[0.06] bg-ink-850/60 p-1">
            {(['ALLE', ...CARRYABLE_CATEGORIES] as const).map((option) => (
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
        </section>
      )}

      {/* Carried */}
      {loading ? (
        <section className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse-soft rounded-xl bg-ink-850/70" />
          ))}
        </section>
      ) : items.length === 0 ? (
        <section className="panel panel-edge animate-fade-up p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-violet-600/30 bg-violet-700/10 text-violet-400">
            <IconShield className="h-6 w-6" />
          </div>
          <p className="font-display text-xl tracking-[0.14em] text-white">
            INVENTARET ER TOMT
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-steel-400">
            Legg eiendeler i inventaret for å ha dem tilgjengelig.
          </p>
          <Link to="/eiendeler" className="btn-secondary mt-5">
            Se eiendeler
            <IconChevron className="h-4 w-4" />
          </Link>
        </section>
      ) : visibleItems.length === 0 ? (
        <section className="panel animate-fade-up p-8 text-center">
          <p className="text-sm text-steel-400">Ingenting i denne kategorien.</p>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {visibleItems.map((item, index) => (
            <InventoryItemCard
              key={item.id}
              item={item}
              mode="carried"
              busy={busyId === item.id}
              anyBusy={busyId !== null}
              onAdd={(id) => act(id, 'add')}
              onRemove={(id) => act(id, 'remove')}
              delay={index * 45}
            />
          ))}
        </section>
      )}

      {/* Stored */}
      {!loading && stored.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg tracking-[0.16em] text-white">
              LAGREDE EIENDELER
            </h2>
            <Link
              to="/eiendeler"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-steel-400 transition hover:text-blood-400"
            >
              Alle eiendeler
            </Link>
          </div>
          <p className="mt-1 text-xs text-steel-500">
            Ting du eier, men ikke bærer. Kjøretøy kan ikke bæres.
          </p>

          {visibleStored.length === 0 ? (
            <p className="panel mt-4 p-6 text-center text-sm text-steel-400">
              Ingenting lagret i denne kategorien.
            </p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {visibleStored.map((item, index) => (
                <InventoryItemCard
                  key={item.id}
                  item={item}
                  mode="stored"
                  busy={busyId === item.id}
                  anyBusy={busyId !== null}
                  onAdd={(id) => act(id, 'add')}
                  onRemove={(id) => act(id, 'remove')}
                  delay={index * 45}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
