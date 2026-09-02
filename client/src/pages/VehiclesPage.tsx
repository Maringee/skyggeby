import { useCallback, useEffect, useState } from 'react';
import type { VehicleCatalogEntryDto, VehicleDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from '@/components/Alert';
import { GataTabs } from '@/components/GataTabs';
import { IconCar, IconMap } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { VehicleCard } from '@/components/VehicleCard';
import { VehicleMarket } from '@/components/VehicleMarket';
import { VehicleMoveDialog } from '@/components/VehicleMoveDialog';
import { useAuth } from '@/state/AuthContext';

export function VehiclesPage() {
  const { player, setPlayer } = useAuth();

  const [vehicles, setVehicles] = useState<VehicleDto[]>([]);
  const [active, setActive] = useState<VehicleDto | null>(null);
  const [maxVehicles, setMaxVehicles] = useState(5);
  const [districtName, setDistrictName] = useState('');
  const [loading, setLoading] = useState(true);

  const [catalog, setCatalog] = useState<VehicleCatalogEntryDto[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  const [moveTarget, setMoveTarget] = useState<VehicleDto | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const apply = useCallback(
    (next: { vehicles: VehicleDto[]; active: VehicleDto | null }) => {
      setVehicles(next.vehicles);
      setActive(next.active);
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const res = await api.vehicles();
      apply(res);
      setMaxVehicles(res.maxVehicles);
      setDistrictName(res.playerDistrictName);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente kjøretøyene dine.');
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const openMarket = async () => {
    setMarketOpen(true);
    setMarketError(null);
    setCatalogLoading(true);
    try {
      const res = await api.vehicleCatalog();
      setCatalog(res.catalog);
      setMaxVehicles(res.maxVehicles);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente katalogen.');
      setMarketOpen(false);
    } finally {
      setCatalogLoading(false);
    }
  };

  const buy = async (vehicleTypeId: string, name: string) => {
    if (buying) return;

    setBuying(true);
    setMarketError(null);
    setMessage(null);

    try {
      // Only the type and the name go over the wire; the price is the server's.
      const res = await api.buyVehicle(vehicleTypeId, name);
      apply(res);
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

  const run = async (
    vehicleId: string,
    action: () => Promise<{ vehicles: VehicleDto[]; active: VehicleDto | null; message: string }>,
    fallback: string,
  ) => {
    if (busyId) return;

    setBusyId(vehicleId);
    setError(null);
    setMessage(null);

    try {
      const res = await action();
      apply(res);
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const activate = (vehicleId: string) =>
    run(vehicleId, () => api.activateVehicle(vehicleId), 'Aktiveringen feilet.');

  const park = (vehicleId: string) =>
    run(vehicleId, () => api.parkVehicle(vehicleId), 'Parkeringen feilet.');

  const sell = async (vehicleId: string) => {
    if (busyId) return;

    setBusyId(vehicleId);
    setError(null);
    setMessage(null);

    try {
      const res = await api.sellVehicle(vehicleId);
      apply(res);
      setPlayer(res.player);
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salget feilet.');
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const move = async (vehicleId: string, destinationDistrictId: string) => {
    if (moving) return;

    setMoving(true);
    setMoveError(null);
    setMessage(null);

    try {
      const res = await api.moveVehicle(vehicleId, destinationDistrictId);
      apply(res);
      setMessage(res.message);
      setMoveTarget(null);
    } catch (err) {
      setMoveError(err instanceof ApiError ? err.message : 'Kjøreturen feilet.');
    } finally {
      setMoving(false);
    }
  };

  if (!player) return null;

  const others = vehicles.filter((vehicle) => !vehicle.isActive);
  const maxReached = vehicles.length >= maxVehicles;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Gata"
        title="Kjøretøy"
        intro="Der du er og der bilen din er, er to forskjellige ting."
        aside={
          <button type="button" onClick={openMarket} className="btn-primary">
            Kjøp kjøretøy
          </button>
        }
      />

      <GataTabs />

      <section className="flex flex-wrap gap-3">
        <span className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
          <IconMap className="h-4 w-4 text-steel-500" />
          <span className="label-xs">Du er i</span>
          <span className="font-semibold text-white">{districtName || '–'}</span>
        </span>
        <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
          <span className="label-xs mr-2">Kjøretøy</span>
          <span className="font-mono font-semibold text-white">
            {vehicles.length} / {maxVehicles}
          </span>
        </span>
        {/* Mobilitet is a foundation, not a bonus: v1 says so rather than
            quietly pretending the skill does something. */}
        <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
          <span className="label-xs mr-2">Mobilitet</span>
          <span className="text-steel-400">
            Påvirker kjøretøyrelaterte systemer senere.
          </span>
        </span>
      </section>

      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {maxReached && !loading && (
        <p className="text-sm text-steel-500">Du har allerede {maxVehicles} kjøretøy.</p>
      )}

      {loading ? (
        <section className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse-soft rounded-xl bg-ink-850/70" />
          ))}
        </section>
      ) : vehicles.length === 0 ? (
        <section className="panel panel-edge animate-fade-up p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-violet-600/30 bg-violet-700/10 text-violet-400">
            <IconCar className="h-6 w-6" />
          </div>
          <p className="font-display text-xl tracking-[0.14em] text-white">
            INGEN KJØRETØY
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-steel-400">
            Du eier ingen kjøretøy ennå.
          </p>
          <button type="button" onClick={openMarket} className="btn-secondary mt-5">
            Kjøp kjøretøy
          </button>
        </section>
      ) : (
        <>
          <section>
            <h2 className="label-xs mb-3">Aktivt kjøretøy</h2>
            {active ? (
              <div className="grid gap-4 md:grid-cols-2">
                <VehicleCard
                  vehicle={active}
                  busy={busyId === active.id}
                  anyBusy={busyId !== null}
                  onActivate={activate}
                  onPark={park}
                  onMove={(vehicle) => {
                    setMoveError(null);
                    setMoveTarget(vehicle);
                  }}
                  onSell={sell}
                  delay={0}
                />
              </div>
            ) : (
              <p className="panel animate-fade-up p-6 text-sm text-steel-400">
                Du har ikke et aktivt kjøretøy.
              </p>
            )}
          </section>

          {others.length > 0 && (
            <section>
              <h2 className="label-xs mb-3">Andre kjøretøy</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {others.map((vehicle, index) => (
                  <VehicleCard
                    key={vehicle.id}
                    vehicle={vehicle}
                    busy={busyId === vehicle.id}
                    anyBusy={busyId !== null}
                    onActivate={activate}
                    onPark={park}
                    onMove={(target) => {
                      setMoveError(null);
                      setMoveTarget(target);
                    }}
                    onSell={sell}
                    delay={index * 45}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {marketOpen && (
        <VehicleMarket
          catalog={catalog}
          loading={catalogLoading}
          owned={vehicles.length}
          maxVehicles={maxVehicles}
          districtName={districtName}
          buying={buying}
          error={marketError}
          onBuy={buy}
          onClose={() => setMarketOpen(false)}
        />
      )}

      {moveTarget && (
        <VehicleMoveDialog
          vehicle={moveTarget}
          playerDistrictName={districtName}
          moving={moving}
          error={moveError}
          onMove={move}
          onClose={() => setMoveTarget(null)}
        />
      )}
    </div>
  );
}
