import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@skyggeby/shared';
import type { BusinessCatalogEntryDto, BusinessDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from '@/components/Alert';
import { BusinessCard } from '@/components/BusinessCard';
import { BusinessDetail } from '@/components/BusinessDetail';
import { BusinessMarket } from '@/components/BusinessMarket';
import { SectionTabs } from '@/components/GataTabs';
import { IconBuilding } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/state/AuthContext';

export function BusinessesPage() {
  const { player, setPlayer } = useAuth();

  const [businesses, setBusinesses] = useState<BusinessDto[]>([]);
  const [maxBusinesses, setMaxBusinesses] = useState(3);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);

  const [catalog, setCatalog] = useState<BusinessCatalogEntryDto[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openEarned, setOpenEarned] = useState(0);
  const [withdrawing, setWithdrawing] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Reading the list is what settles it: the server brings every account up
      // to date before it answers.
      const res = await api.businesses();
      setBusinesses(res.businesses);
      setMaxBusinesses(res.maxBusinesses);
      setTotalValue(res.totalValue);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente virksomhetene dine.');
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
      const res = await api.businessCatalog();
      setCatalog(res.catalog);
      setMaxBusinesses(res.maxBusinesses);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente markedet.');
      setMarketOpen(false);
    } finally {
      setCatalogLoading(false);
    }
  };

  const buy = async (businessTypeId: string, name: string) => {
    if (buying) return;

    setBuying(true);
    setMarketError(null);
    setMessage(null);

    try {
      // Only the type and the name go over the wire; the price is the server's.
      const res = await api.buyBusiness(businessTypeId, name);
      setBusinesses(res.businesses);
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

  const openDetail = async (businessId: string) => {
    setOpenId(businessId);
    setOpenEarned(0);
    setError(null);
    try {
      const res = await api.business(businessId);
      setOpenEarned(res.earned);
      setBusinesses((current) =>
        current.map((item) => (item.id === res.business.id ? res.business : item)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente virksomheten.');
      setOpenId(null);
    }
  };

  const withdraw = async (businessId: string) => {
    if (withdrawing) return;

    setWithdrawing(true);
    setError(null);
    setMessage(null);

    try {
      const res = await api.withdrawFromBusiness(businessId);
      setBusinesses(res.businesses);
      setPlayer(res.player);
      setMessage(res.message);
      setOpenEarned(0);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uttaket feilet. Prøv igjen.');
      void load();
    } finally {
      setWithdrawing(false);
    }
  };

  if (!player) return null;

  const open = businesses.find((item) => item.id === openId) ?? null;
  const maxReached = businesses.length >= maxBusinesses;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Økonomi"
        title="Virksomheter"
        intro="Ting du eier og driver. De tjener penger over tid, og koster å holde i gang."
        aside={
          <button type="button" onClick={openMarket} className="btn-primary">
            Kjøp virksomhet
          </button>
        }
      />

      {/* Kept out of the header's aside, which does not shrink: two chips plus a
          button would run off the right edge of a phone. */}
      <section className="flex flex-wrap gap-3">
        <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
          <span className="label-xs mr-2">Virksomheter</span>
          <span className="font-mono font-semibold text-white">
            {businesses.length} / {maxBusinesses}
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
        <p className="text-sm text-steel-500">Maksimalt antall virksomheter nådd.</p>
      )}

      {loading ? (
        <section className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-80 animate-pulse-soft rounded-xl bg-ink-850/70" />
          ))}
        </section>
      ) : businesses.length === 0 ? (
        <section className="panel panel-edge animate-fade-up p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-violet-600/30 bg-violet-700/10 text-violet-400">
            <IconBuilding className="h-6 w-6" />
          </div>
          <p className="font-display text-xl tracking-[0.14em] text-white">
            INGEN VIRKSOMHETER
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-steel-400">
            Bygg opp kapital og kjøp din første virksomhet.
          </p>
          <button type="button" onClick={openMarket} className="btn-secondary mt-5">
            Kjøp virksomhet
          </button>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {businesses.map((business, index) => (
            <BusinessCard
              key={business.id}
              business={business}
              onOpen={openDetail}
              delay={index * 45}
            />
          ))}
        </section>
      )}

      {marketOpen && (
        <BusinessMarket
          catalog={catalog}
          loading={catalogLoading}
          owned={businesses.length}
          maxBusinesses={maxBusinesses}
          buying={buying}
          error={marketError}
          onBuy={buy}
          onClose={() => setMarketOpen(false)}
        />
      )}

      {open && (
        <BusinessDetail
          business={open}
          earned={openEarned}
          busy={withdrawing}
          onWithdraw={withdraw}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
