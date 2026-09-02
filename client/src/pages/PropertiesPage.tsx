import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@skyggeby/shared';
import type { PropertyCatalogEntryDto, PropertyDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from '@/components/Alert';
import { SectionTabs } from '@/components/GataTabs';
import { IconHome } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { PropertyCard } from '@/components/PropertyCard';
import { PropertyDetail } from '@/components/PropertyDetail';
import { PropertyMarket } from '@/components/PropertyMarket';
import { useAuth } from '@/state/AuthContext';

export function PropertiesPage() {
  const { player, setPlayer } = useAuth();

  const [properties, setProperties] = useState<PropertyDto[]>([]);
  const [maxProperties, setMaxProperties] = useState(3);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);

  const [catalog, setCatalog] = useState<PropertyCatalogEntryDto[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketOwned, setMarketOwned] = useState(0);
  const [buying, setBuying] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.properties();
      setProperties(res.properties);
      setMaxProperties(res.maxProperties);
      setTotalValue(res.totalValue);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente eiendommene dine.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openMarket = async () => {
    setMarketOpen(true);
    setMarketError(null);
    setCatalogLoading(true);
    try {
      const res = await api.propertyCatalog();
      setCatalog(res.catalog);
      setMaxProperties(res.maxProperties);
      // The count the market reasons about is the server's, not whatever the
      // page happened to load earlier.
      setMarketOwned(res.count);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente markedet.');
      setMarketOpen(false);
    } finally {
      setCatalogLoading(false);
    }
  };

  const buy = async (propertyTypeId: string, name: string) => {
    if (buying) return;

    setBuying(true);
    setMarketError(null);
    setMessage(null);

    try {
      // Only the type and the name go over the wire; the price is the server's.
      const res = await api.buyProperty(propertyTypeId, name);
      setProperties(res.properties);
      setPlayer(res.player);
      setMessage(res.message);
      setMarketOpen(false);
      void load();
    } catch (err) {
      setMarketError(err instanceof ApiError ? err.message : 'Kjøpet feilet. Prøv igjen.');
    } finally {
      setBuying(false);
    }
  };

  const sell = async (propertyId: string) => {
    if (busyId) return;

    setBusyId(propertyId);
    setError(null);
    setMessage(null);

    try {
      const res = await api.sellProperty(propertyId);
      setProperties(res.properties);
      setPlayer(res.player);
      setMessage(res.message);
      setOpenId(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salget feilet. Prøv igjen.');
      void load();
    } finally {
      setBusyId(null);
    }
  };

  if (!player) return null;

  const open = properties.find((item) => item.id === openId) ?? null;
  const maxReached = properties.length >= maxProperties;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Økonomi"
        title="Eiendom"
        intro="Steder du eier i byen. De har en fast adresse, og de blir stående."
        aside={
          <button type="button" onClick={openMarket} className="btn-primary">
            Kjøp eiendom
          </button>
        }
      />

      {/* Kept out of the header's aside, which does not shrink: two chips plus a
          button would run off the right edge of a phone. */}
      <section className="flex flex-wrap gap-3">
        <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
          <span className="label-xs mr-2">Eiendommer</span>
          <span className="font-mono font-semibold text-white">
            {properties.length} / {maxProperties}
          </span>
        </span>
        <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
          <span className="label-xs mr-2">Samlet verdi</span>
          <span className="font-mono font-semibold text-white">
            {formatMoney(totalValue)}
          </span>
        </span>
      </section>

      <SectionTabs section="/okonomi" />

      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {maxReached && !loading && (
        <p className="text-sm text-steel-500">Maksimalt antall eiendommer nådd.</p>
      )}

      {loading ? (
        <section className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse-soft rounded-xl bg-ink-850/70" />
          ))}
        </section>
      ) : properties.length === 0 ? (
        <section className="panel panel-edge animate-fade-up p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-violet-600/30 bg-violet-700/10 text-violet-400">
            <IconHome className="h-6 w-6" />
          </div>
          <p className="font-display text-xl tracking-[0.14em] text-white">
            INGEN EIENDOMMER
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-steel-400">
            Du eier ingen eiendommer ennå.
          </p>
          <button type="button" onClick={openMarket} className="btn-secondary mt-5">
            Kjøp eiendom
          </button>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {properties.map((property, index) => (
            <PropertyCard
              key={property.id}
              property={property}
              busy={busyId === property.id}
              anyBusy={busyId !== null}
              onOpen={setOpenId}
              onSell={sell}
              delay={index * 45}
            />
          ))}
        </section>
      )}

      {marketOpen && (
        <PropertyMarket
          catalog={catalog}
          loading={catalogLoading}
          owned={marketOwned}
          maxProperties={maxProperties}
          buying={buying}
          error={marketError}
          onBuy={buy}
          onClose={() => setMarketOpen(false)}
        />
      )}

      {open && (
        <PropertyDetail
          property={open}
          busy={busyId === open.id}
          onSell={sell}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
