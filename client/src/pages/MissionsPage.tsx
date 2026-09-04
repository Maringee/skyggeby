import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MissionDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from '@/components/Alert';
import { MissionCard } from '@/components/MissionCard';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/state/AuthContext';
import { useMissions } from '@/state/MissionsContext';

type Tab = 'aktive' | 'tilgjengelige' | 'fullforte';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'aktive', label: 'Aktive' },
  { id: 'tilgjengelige', label: 'Tilgjengelige' },
  { id: 'fullforte', label: 'Fullførte' },
];

/** Which tab a mission belongs in. Locked and blocked ones are still offers. */
function tabOf(mission: MissionDto): Tab {
  if (mission.availability === 'AKTIV') return 'aktive';
  if (mission.availability === 'FULLFORT') return 'fullforte';
  return 'tilgjengelige';
}

export function MissionsPage() {
  const { player, refresh } = useAuth();
  // The page already has a fresh count, so the badge need not fetch again.
  const { setDeliverable, setActive } = useMissions();

  const [missions, setMissions] = useState<MissionDto[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [maxActive, setMaxActive] = useState(3);
  const [chainContinues, setChainContinues] = useState(0);
  const [tab, setTab] = useState<Tab>('aktive');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.missions();
      setMissions(res.missions);
      setActiveCount(res.activeCount);
      setMaxActive(res.maxActive);
      setChainContinues(res.chainContinues);
      setDeliverable(res.deliverableCount);
      setActive(res.missions.filter((m) => m.availability === 'AKTIV'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente oppdragene dine.');
    } finally {
      setLoading(false);
    }
  }, [setDeliverable, setActive]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every mutation returns the whole list, so one call refreshes the page. */
  const run = async (
    missionId: string,
    action: (
      id: string,
    ) => Promise<{
      missions: MissionDto[];
      activeCount: number;
      deliverableCount: number;
      message: string;
    }>,
    fallback: string,
  ) => {
    if (busyId) return;

    setBusyId(missionId);
    setError(null);
    setMessage(null);

    try {
      const res = await action(missionId);
      setMissions(res.missions);
      setActiveCount(res.activeCount);
      setDeliverable(res.deliverableCount);
      setActive(res.missions.filter((m) => m.availability === 'AKTIV'));
      setMessage(res.message);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const accept = (id: string) =>
    run(id, api.acceptMission, 'Kunne ikke ta oppdraget. Prøv igjen.');

  const abandon = (id: string) =>
    run(id, api.abandonMission, 'Kunne ikke avbryte oppdraget. Prøv igjen.');

  const deliver = async (id: string) => {
    if (busyId) return;

    setBusyId(id);
    setError(null);
    setMessage(null);

    try {
      const res = await api.deliverMission(id);
      setMissions(res.missions);
      setActiveCount(res.activeCount);
      setDeliverable(res.deliverableCount);
      setActive(res.missions.filter((m) => m.availability === 'AKTIV'));

      // What opened up matters more than what was paid, so it is said out loud.
      const contacts = res.unlockedContacts;
      const opened = res.unlockedMissions;
      setMessage(
        contacts.length > 0
          ? `${res.message} ${contacts.join(', ')} vil snakke med deg.`
          : opened.length > 0
            ? `${res.message} Nytt oppdrag åpnet: ${opened.join(', ')}.`
            : res.message,
      );

      // Money, XP and heat may all have moved, so the header must follow.
      await refresh();
      setTab('fullforte');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke levere oppdraget.');
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const grouped = useMemo(() => {
    const buckets: Record<Tab, MissionDto[]> = {
      aktive: [],
      tilgjengelige: [],
      fullforte: [],
    };
    for (const mission of missions) buckets[tabOf(mission)].push(mission);

    // Offers read best with the ones you can actually take first, then by level.
    buckets.tilgjengelige.sort((a, b) => {
      const takeable =
        Number(b.availability === 'TILGJENGELIG') - Number(a.availability === 'TILGJENGELIG');
      return takeable !== 0 ? takeable : a.minLevel - b.minLevel;
    });
    buckets.aktive.sort((a, b) => Number(b.deliverable) - Number(a.deliverable));

    return buckets;
  }, [missions]);

  if (!player) return null;

  const shown = grouped[tab];
  const deliverable = grouped.aktive.filter((mission) => mission.deliverable).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Oppdrag"
        title="Oppdrag"
        intro="Folk i byen har ting de vil ha gjort. Betalingen er deres, arbeidet er ditt."
        aside={
          <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
            <span className="label-xs mr-2">Aktive</span>
            <span className="font-mono font-semibold text-white">
              {activeCount} / {maxActive}
            </span>
          </span>
        }
      />

      <nav
        aria-label="Oppdragsfaner"
        className="flex flex-wrap animate-fade-in gap-1 rounded-lg border border-white/[0.06] bg-ink-850/60 p-1"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              tab === entry.id
                ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow'
                : 'text-steel-400 hover:text-white'
            }`}
          >
            {entry.label}
            {entry.id === 'aktive' && deliverable > 0 && (
              <span className="ml-2 rounded-full bg-neon/20 px-1.5 py-0.5 font-mono text-[0.6rem] text-neon">
                {deliverable}
              </span>
            )}
          </button>
        ))}
      </nav>

      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse-soft rounded-lg bg-ink-850/70" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <section className="panel p-8 text-center">
          <p className="text-sm text-steel-400">
            {tab === 'aktive'
              ? 'Du har ingen oppdrag på gang. Se hva folk tilbyr under Tilgjengelige.'
              : tab === 'fullforte'
                ? 'Du har ikke fullført noen oppdrag ennå.'
                : 'Ingen tilbyr deg noe akkurat nå. Bli kjent med flere folk under Meg · Kontakter.'}
          </p>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              busy={busyId !== null}
              onAccept={accept}
              onDeliver={deliver}
              onAbandon={abandon}
            />
          ))}
        </div>
      )}

      {tab === 'tilgjengelige' && chainContinues > 0 && (
        <p className="text-center text-xs text-steel-500">
          Denne kjeden fortsetter. Fullfør det du har på gang, så åpner det seg mer.
        </p>
      )}
    </div>
  );
}
