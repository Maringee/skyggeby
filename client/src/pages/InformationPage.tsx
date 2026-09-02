import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  INFORMATION_TYPES,
  INFORMATION_TYPE_LABELS,
  formatDuration,
  resolveDistrict,
} from '@skyggeby/shared';
import type { InformationDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from '@/components/Alert';
import { GataTabs } from '@/components/GataTabs';
import { IconBolt, IconClock, IconSearch } from '@/components/Icons';
import { InformationCard } from '@/components/InformationCard';
import { PageHeader } from '@/components/PageHeader';
import { useNow } from '@/lib/useNow';
import { projectedEnergy } from '@/lib/vitals';
import { useAuth } from '@/state/AuthContext';

type StatusFilter = 'alle' | 'brukbar' | 'brukt';
type SortOrder = 'nyeste' | 'verdi' | 'palitelighet';

const STATUS_LABELS: Record<StatusFilter, string> = {
  alle: 'Alle',
  brukbar: 'Brukbar',
  brukt: 'Brukt',
};

const SORT_LABELS: Record<SortOrder, string> = {
  nyeste: 'Nyeste først',
  verdi: 'Høyest verdi',
  palitelighet: 'Mest pålitelig',
};

export function InformationPage() {
  const { player, setPlayer } = useAuth();
  const [information, setInformation] = useState<InformationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [exploring, setExploring] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [energyCost, setEnergyCost] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [found, setFound] = useState<InformationDto | null>(null);

  const [status, setStatus] = useState<StatusFilter>('alle');
  const [typeFilter, setTypeFilter] = useState<string>('alle');
  const [sort, setSort] = useState<SortOrder>('nyeste');

  const now = useNow(1000);

  const load = useCallback(async () => {
    try {
      const res = await api.information();
      setInformation(res.information);
      setCooldown(res.exploreCooldownSeconds);
      setEnergyCost(res.exploreEnergyCost);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente informasjonen din.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The cooldown is server-issued; this only counts the returned number down.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((prev) => Math.max(0, prev - 1)), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  const explore = async () => {
    if (exploring) return;

    setExploring(true);
    setError(null);
    setMessage(null);
    setFound(null);

    try {
      // Sends nothing: the server decides where, what it costs and what turns up.
      const res = await api.explore();
      setInformation(res.information);
      setCooldown(res.exploreCooldownSeconds);
      setMessage(res.message);
      setFound(res.found);
      setPlayer(res.player);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Letingen mislyktes. Prøv igjen.');
      void load();
    } finally {
      setExploring(false);
    }
  };

  const visible = useMemo(() => {
    const filtered = information.filter((item) => {
      if (status === 'brukt' && !item.used) return false;
      if (status === 'brukbar' && (item.used || item.freshness === 'UTDATERT')) return false;
      if (typeFilter !== 'alle' && item.type !== typeFilter) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sort === 'verdi') sorted.sort((a, b) => b.currentValue - a.currentValue);
    else if (sort === 'palitelighet') sorted.sort((a, b) => b.reliability - a.reliability);
    else
      sorted.sort(
        (a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime(),
      );

    return sorted;
  }, [information, status, typeFilter, sort]);

  if (!player) return null;

  const district = resolveDistrict(player.currentDistrictId);
  const energy = projectedEnergy(player, now);
  const canAfford = energy >= energyCost;
  const ready = cooldown <= 0;
  const usable = information.filter((i) => !i.used && i.freshness !== 'UTDATERT').length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Gata"
        title="Informasjon"
        intro="Kunnskap om byen. Noe stemmer, noe gjør det ikke — og du finner det ikke ut før du bruker den."
        aside={
          <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
            <span className="label-xs mr-2">Brukbar</span>
            <span className="font-mono font-semibold text-white">{usable}</span>
          </span>
        }
      />

      <GataTabs />

      {/* Explore */}
      <section className="panel panel-edge animate-fade-up p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg tracking-[0.16em] text-white">
              UTFORSK OMRÅDET
            </h2>
            <p className="mt-1 text-xs text-steel-500">
              Du leter der du faktisk står:{' '}
              <span className="font-semibold text-violet-400">{district.name}</span>. Hva du
              finner avgjøres av serveren.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1.5 text-xs text-steel-400">
                <IconBolt className="h-3.5 w-3.5 text-violet-400" />
                Koster {energyCost} energi
              </span>
              <span className="flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1.5 text-xs text-steel-400">
                <IconClock className="h-3.5 w-3.5 text-violet-400" />
                Avkjøling: 5 minutter
              </span>
            </div>
          </div>

          <div className="w-full shrink-0 sm:w-auto">
            <button
              type="button"
              onClick={explore}
              disabled={exploring || !ready || !canAfford}
              className="btn-primary w-full sm:w-56"
            >
              {exploring ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Leter ...
                </>
              ) : (
                <>
                  <IconSearch className="h-4 w-4" />
                  Utforsk området
                </>
              )}
            </button>
            <p className="mt-2 text-center text-xs text-steel-500 sm:text-right">
              {!ready
                ? `Klar om ${formatDuration(cooldown)}`
                : !canAfford
                  ? `Krever ${energyCost} energi, du har ${energy}`
                  : 'Klar'}
            </p>
          </div>
        </div>

        {message && (
          <div className="mt-5">
            <Alert tone={found ? 'success' : 'info'}>{message}</Alert>
          </div>
        )}
        {error && (
          <div className="mt-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </section>

      {/* Filters */}
      {information.length > 0 && (
        <section className="flex flex-wrap items-center gap-2 animate-fade-in">
          <div className="flex gap-1 rounded-lg border border-white/[0.06] bg-ink-850/60 p-1">
            {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setStatus(option)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                  status === option
                    ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white'
                    : 'text-steel-400 hover:text-white'
                }`}
              >
                {STATUS_LABELS[option]}
              </button>
            ))}
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filtrer på type"
            className="rounded-lg border border-white/[0.07] bg-ink-850/80 px-3 py-2 text-xs text-steel-300 outline-none transition focus:border-violet-500/60"
          >
            <option value="alle">Alle typer</option>
            {INFORMATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {INFORMATION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOrder)}
            aria-label="Sorter"
            className="rounded-lg border border-white/[0.07] bg-ink-850/80 px-3 py-2 text-xs text-steel-300 outline-none transition focus:border-violet-500/60"
          >
            {(Object.keys(SORT_LABELS) as SortOrder[]).map((option) => (
              <option key={option} value={option}>
                {SORT_LABELS[option]}
              </option>
            ))}
          </select>

          <span className="ml-auto text-xs text-steel-500">
            Viser {visible.length} av {information.length}
          </span>
        </section>
      )}

      {/* List */}
      {loading ? (
        <section className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse-soft rounded-xl bg-ink-850/70" />
          ))}
        </section>
      ) : information.length === 0 ? (
        <section className="panel panel-edge animate-fade-up p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-violet-600/30 bg-violet-700/10 text-violet-400">
            <IconSearch className="h-6 w-6" />
          </div>
          <p className="font-display text-xl tracking-[0.14em] text-white">
            DU HAR INGEN INFORMASJON ENNÅ
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-steel-400">
            Utforsk området for å lete etter noe nytt.
          </p>
        </section>
      ) : visible.length === 0 ? (
        <section className="panel animate-fade-up p-8 text-center">
          <p className="text-sm text-steel-400">
            Ingenting matcher filteret. Prøv å vise alle.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {visible.map((item, index) => (
            <InformationCard
              key={item.id}
              information={item}
              now={now}
              delay={index * 45}
            />
          ))}
        </section>
      )}
    </div>
  );
}
