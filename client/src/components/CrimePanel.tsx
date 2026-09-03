import { useCallback, useEffect, useState } from 'react';
import type { CrimeActionResponse, CrimeOutcomeDto, CrimeStateDto, PlayerDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { useNow } from '@/lib/useNow';
import { Alert } from './Alert';
import { CrimeCard } from './CrimeCard';
import { DistrictEffect } from './DistrictEffect';
import { CrimeOutcomeBanner } from './CrimeOutcomeBanner';
import { IconTarget } from './Icons';

interface CrimePanelProps {
  player: PlayerDto;
  onOutcome: (result: CrimeActionResponse) => void;
}

export function CrimePanel({ player, onOutcome }: CrimePanelProps) {
  const [crimes, setCrimes] = useState<CrimeStateDto[]>([]);
  const [districtName, setDistrictName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCrimeId, setBusyCrimeId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CrimeOutcomeDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One shared clock drives every cooldown countdown and the energy projection.
  const now = useNow(1000);

  const load = useCallback(async () => {
    try {
      const res = await api.crimes();
      setCrimes(res.crimes);
      setDistrictName(res.district.districtName);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Kunne ikke hente kriminalitetene.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Odds and payouts depend on the district, so a move must refresh the board.
  useEffect(() => {
    void load();
  }, [load, player.currentDistrictId]);

  const commit = async (crimeId: string) => {
    if (busyCrimeId) return;

    setBusyCrimeId(crimeId);
    setError(null);

    try {
      // The client only names the crime. Everything else comes back decided.
      const result = await api.performCrime(crimeId);
      setCrimes(result.crimes);
      setDistrictName(result.district.districtName);
      setOutcome(result.outcome);
      onOutcome(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Forsøket feilet. Prøv igjen.');
      // The server may have moved on without us; resync the board.
      void load();
    } finally {
      setBusyCrimeId(null);
    }
  };

  const unlockedCount = crimes.filter((crime) => player.level >= crime.minLevel).length;

  return (
    <section className="panel panel-edge animate-fade-up p-6" style={{ animationDelay: '120ms' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg tracking-[0.16em] text-white">
            <IconTarget className="h-5 w-5 text-blood-500" />
            KRIMINALITET
          </h2>
          {districtName && (
            <p className="mt-1 text-xs text-steel-500">
              Tallene gjelder{' '}
              <span className="font-semibold text-violet-400">{districtName}</span>.
            </p>
          )}
        </div>
        <p className="label-xs">
          {unlockedCount} av {crimes.length} åpne
        </p>
      </div>

      <div className="mt-5">
        <DistrictEffect districtId={player.currentDistrictId} />
      </div>

      {outcome && (
        <div className="mt-5">
          <CrimeOutcomeBanner outcome={outcome} />
        </div>
      )}

      {error && (
        <div className="mt-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse-soft rounded-xl bg-ink-850/70" />
            ))
          : crimes.map((crime, index) => (
              <CrimeCard
                key={crime.id}
                crime={crime}
                player={player}
                now={now}
                busy={busyCrimeId === crime.id}
                anyBusy={busyCrimeId !== null}
                onCommit={commit}
                delay={index * 60}
              />
            ))}
      </div>
    </section>
  );
}
