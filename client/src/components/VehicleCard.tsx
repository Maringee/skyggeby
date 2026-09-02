import { formatMoney } from '@skyggeby/shared';
import type { VehicleDto } from '@skyggeby/shared';
import { IconCar, IconMap } from './Icons';
import { Meter } from './Meter';

interface VehicleCardProps {
  vehicle: VehicleDto;
  busy: boolean;
  anyBusy: boolean;
  onActivate: (vehicleId: string) => void;
  onPark: (vehicleId: string) => void;
  onMove: (vehicle: VehicleDto) => void;
  onSell: (vehicleId: string) => void;
  delay: number;
}

/**
 * One owned vehicle.
 *
 * The district shown is the vehicle's own. When it does not match the player's,
 * every action that needs a hand on the wheel is disabled and the card says why
 * - the server would refuse anyway, this just explains it first.
 */
export function VehicleCard({
  vehicle,
  busy,
  anyBusy,
  onActivate,
  onPark,
  onMove,
  onSell,
  delay,
}: VehicleCardProps) {
  return (
    <article
      style={{ animationDelay: `${delay}ms` }}
      className={`panel animate-fade-up p-5 transition hover:border-white/[0.14] ${
        vehicle.isActive ? 'border-blood-600/40 bg-blood-700/[0.06]' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
              vehicle.isActive
                ? 'border-blood-600/40 bg-blood-700/15 text-blood-400'
                : 'border-violet-600/35 bg-violet-700/12 text-violet-400'
            }`}
          >
            <IconCar className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            {/* The player's own name leads; the catalogue type stays under it. */}
            <h3 className="truncate font-display text-lg tracking-[0.1em] text-white">
              {vehicle.name}
            </h3>
            <p className="label-xs mt-0.5">{vehicle.typeName}</p>
          </div>
        </div>

        <span
          className={`shrink-0 rounded-md border px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${
            vehicle.isActive
              ? 'border-blood-600/40 bg-blood-700/15 text-blood-400'
              : 'border-white/[0.08] bg-white/[0.02] text-steel-400'
          }`}
        >
          {vehicle.statusLabel}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-white/[0.05] pt-4">
        <div className="min-w-0">
          <dt className="label-xs">Står i</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 text-sm text-white">
            <IconMap className="h-3.5 w-3.5 shrink-0 text-steel-500" />
            <span className="truncate">{vehicle.districtName}</span>
          </dd>
        </div>
        <div className="text-right">
          <dt className="label-xs">Verdi</dt>
          <dd className="mt-0.5 font-mono text-sm text-white">
            {formatMoney(vehicle.saleValue)}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <Meter
          value={vehicle.condition}
          max={100}
          tone="green"
          label="Tilstand"
          hint={`${vehicle.condition} %`}
        />
      </div>

      <dl className="mt-3 flex items-center justify-between gap-3 text-xs">
        <div>
          <dt className="label-xs">Risiko</dt>
          <dd className="mt-0.5 text-steel-300">{vehicle.riskLabel}</dd>
        </div>
        <div className="text-right">
          <dt className="label-xs">Kjøpt for</dt>
          <dd className="mt-0.5 font-mono text-steel-300">
            {formatMoney(vehicle.purchasePrice)}
          </dd>
        </div>
      </dl>

      {vehicle.blockedText && (
        <p className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-steel-400">
          {vehicle.blockedText}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {vehicle.isActive ? (
          <>
            <button
              type="button"
              onClick={() => onMove(vehicle)}
              disabled={!vehicle.reachable || anyBusy}
              className={`btn flex-1 py-2.5 text-xs ${
                vehicle.reachable
                  ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow hover:from-blood-500 hover:to-blood-400'
                  : 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
              }`}
            >
              {busy ? 'Jobber ...' : 'Flytt'}
            </button>
            <button
              type="button"
              onClick={() => onPark(vehicle.id)}
              disabled={anyBusy}
              className="btn-ghost flex-1 py-2.5 text-xs"
            >
              Parker
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onActivate(vehicle.id)}
            disabled={!vehicle.reachable || anyBusy}
            className={`btn flex-1 py-2.5 text-xs ${
              vehicle.reachable
                ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow hover:from-blood-500 hover:to-blood-400'
                : 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
            }`}
          >
            {busy ? 'Jobber ...' : 'Aktiver'}
          </button>
        )}

        <button
          type="button"
          onClick={() => onSell(vehicle.id)}
          disabled={anyBusy}
          className="btn-ghost px-4 py-2.5 text-xs"
        >
          Selg
        </button>
      </div>
    </article>
  );
}
