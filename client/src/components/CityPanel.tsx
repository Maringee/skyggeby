import { useCallback, useEffect, useState } from 'react';
import type { DistrictStateDto, MoveResponse, PlayerDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from './Alert';
import { CityMap } from './CityMap';
import { DistrictCard } from './DistrictCard';

interface CityPanelProps {
  player: PlayerDto;
  /** Called with the authoritative response after a successful move. */
  onMoved: (result: MoveResponse) => void;
}

export function CityPanel({ player, onMoved }: CityPanelProps) {
  const [districts, setDistricts] = useState<DistrictStateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.city();
      setDistricts(res.districts);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente bykartet.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the board in sync when the player moves from somewhere else.
  useEffect(() => {
    setDistricts((prev) =>
      prev.map((d) => ({ ...d, current: d.id === player.currentDistrictId })),
    );
  }, [player.currentDistrictId]);

  const move = async (districtId: string) => {
    if (movingTo) return;

    setMovingTo(districtId);
    setError(null);
    setMessage(null);

    try {
      const result = await api.move(districtId);
      setDistricts(result.districts);
      setMessage(result.message);
      onMoved(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Klarte ikke å flytte deg.');
      void load();
    } finally {
      setMovingTo(null);
    }
  };

  const current = districts.find((d) => d.current);

  return (
    <section className="panel panel-edge animate-fade-up p-6" style={{ animationDelay: '80ms' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg tracking-[0.16em] text-white">DISTRIKTER</h2>
        {current && (
          <p className="label-xs">
            Du er i <span className="text-blood-400">{current.name}</span>
          </p>
        )}
      </div>

      {message && (
        <div className="mt-5">
          <Alert tone="success">{message}</Alert>
        </div>
      )}
      {error && (
        <div className="mt-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {loading ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="h-64 animate-pulse-soft rounded-xl bg-ink-850/70" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse-soft rounded-xl bg-ink-850/70" />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <CityMap
              districts={districts}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <p className="mt-3 text-[0.68rem] leading-relaxed text-steel-500">
              Grønn ring betyr lite politi, rød betyr mye. Klikk et strøk for å
              markere det i listen.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {districts.map((district, index) => (
              <DistrictCard
                key={district.id}
                district={district}
                selected={selectedId === district.id}
                busy={movingTo === district.id}
                anyBusy={movingTo !== null}
                onSelect={setSelectedId}
                onMove={move}
                delay={index * 50}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
