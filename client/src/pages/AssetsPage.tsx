import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  formatMoney,
  formatNumber,
} from '@skyggeby/shared';
import type { AssetCatalogEntryDto, AssetCategory, AssetDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from '@/components/Alert';
import { AssetCard } from '@/components/AssetCard';
import { AssetCatalog } from '@/components/AssetCatalog';
import { SectionTabs } from '@/components/GataTabs';
import { IconBank, IconCash, IconShield } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { useAuth } from '@/state/AuthContext';

export function AssetsPage() {
  const { player, setPlayer } = useAuth();

  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [totals, setTotals] = useState({ value: 0, saleValue: 0, count: 0 });
  const [loading, setLoading] = useState(true);

  const [catalog, setCatalog] = useState<AssetCatalogEntryDto[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [category, setCategory] = useState<AssetCategory | 'ALLE'>('ALLE');

  const load = useCallback(async () => {
    try {
      const res = await api.assets();
      setAssets(res.assets);
      setTotals({ value: res.totalValue, saleValue: res.totalSaleValue, count: res.count });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente eiendelene dine.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCatalog = async () => {
    setCatalogOpen(true);
    setCatalogLoading(true);
    try {
      const res = await api.assetCatalog();
      setCatalog(res.catalog);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente katalogen.');
      setCatalogOpen(false);
    } finally {
      setCatalogLoading(false);
    }
  };

  const buy = async (assetTypeId: string) => {
    if (busyId) return;

    setBusyId(assetTypeId);
    setError(null);
    setMessage(null);

    try {
      // Only the type id goes over the wire; the server sets the price.
      const res = await api.buyAsset(assetTypeId);
      setAssets(res.assets);
      setPlayer(res.player);
      setMessage(res.message);
      setCatalogOpen(false);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kjøpet feilet. Prøv igjen.');
    } finally {
      setBusyId(null);
    }
  };

  const sell = async (assetId: string) => {
    if (busyId) return;

    setBusyId(assetId);
    setError(null);
    setMessage(null);

    try {
      const res = await api.sellAsset(assetId);
      setAssets(res.assets);
      setPlayer(res.player);
      setMessage(res.message);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salget feilet. Prøv igjen.');
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const visible = useMemo(
    () => (category === 'ALLE' ? assets : assets.filter((a) => a.category === category)),
    [assets, category],
  );

  if (!player) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Økonomi"
        title="Eiendeler"
        intro="Ting du eier. De koster å skaffe, taper seg i verdi, og forteller noe om deg."
        aside={
          <button type="button" onClick={openCatalog} className="btn-primary">
            Kjøp eiendel
          </button>
        }
      />

      <SectionTabs section="/okonomi" />

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Kontanter"
          value={formatMoney(player.cash)}
          accent="green"
          icon={<IconCash />}
          delay={0}
        />
        <StatCard
          label="Eiendelsverdi"
          value={formatMoney(totals.value)}
          sub={`Salgsverdi i dag: ${formatMoney(totals.saleValue)}`}
          accent="violet"
          icon={<IconBank />}
          delay={60}
        />
        <StatCard
          label="Antall eiendeler"
          value={formatNumber(totals.count)}
          accent="steel"
          icon={<IconShield />}
          delay={120}
        />
      </section>

      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {assets.length > 0 && (
        <section className="flex flex-wrap items-center gap-2 animate-fade-in">
          <div className="flex flex-wrap gap-1 rounded-lg border border-white/[0.06] bg-ink-850/60 p-1">
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
          <span className="ml-auto text-xs text-steel-500">
            Viser {visible.length} av {assets.length}
          </span>
        </section>
      )}

      {loading ? (
        <section className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-80 animate-pulse-soft rounded-xl bg-ink-850/70" />
          ))}
        </section>
      ) : assets.length === 0 ? (
        <section className="panel panel-edge animate-fade-up p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-violet-600/30 bg-violet-700/10 text-violet-400">
            <IconBank className="h-6 w-6" />
          </div>
          <p className="font-display text-xl tracking-[0.14em] text-white">
            DU EIER INGENTING ENNÅ
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-steel-400">
            Åpne katalogen for å kjøpe din første eiendel.
          </p>
          <button type="button" onClick={openCatalog} className="btn-secondary mt-5">
            Kjøp eiendel
          </button>
        </section>
      ) : visible.length === 0 ? (
        <section className="panel animate-fade-up p-8 text-center">
          <p className="text-sm text-steel-400">Ingenting i denne kategorien.</p>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {visible.map((asset, index) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              busy={busyId === asset.id}
              anyBusy={busyId !== null}
              onSell={sell}
              delay={index * 45}
            />
          ))}
        </section>
      )}

      {catalogOpen && (
        <AssetCatalog
          catalog={catalog}
          loading={catalogLoading}
          buyingId={busyId}
          anyBusy={busyId !== null}
          onBuy={buy}
          onClose={() => setCatalogOpen(false)}
        />
      )}
    </div>
  );
}
