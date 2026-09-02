import { useEffect, useState } from 'react';
import { DISTRICTS } from '@skyggeby/shared';
import type { VehicleDto } from '@skyggeby/shared';
import { IconClose, IconMap } from './Icons';

interface VehicleMoveDialogProps {
  vehicle: VehicleDto;
  /** Where the player is standing right now. */
  playerDistrictName: string;
  moving: boolean;
  error: string | null;
  onMove: (vehicleId: string, destinationDistrictId: string) => void;
  onClose: () => void;
}

/**
 * Choosing where to drive.
 *
 * The list comes from the shared district catalogue, but the destination is
 * validated again on the server - this dialog only saves the player a rejected
 * request, it does not decide anything.
 */
export function VehicleMoveDialog({
  vehicle,
  playerDistrictName,
  moving,
  error,
  onMove,
  onClose,
}: VehicleMoveDialogProps) {
  const [destination, setDestination] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        type="button"
        aria-label="Lukk"
        onClick={onClose}
        className="fixed inset-0 animate-fade-in bg-black/75 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-label={`Flytt ${vehicle.name}`}
        className="panel panel-edge relative my-auto w-full max-w-lg animate-fade-up p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-2xl tracking-[0.16em] text-white">
              FLYTT KJØRETØY
            </h2>
            <p className="mt-1 text-xs text-steel-500">
              {vehicle.name} står i {vehicle.districtName}. Du blir igjen i{' '}
              {playerDistrictName}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk"
            className="rounded-lg border border-white/[0.08] p-2 text-steel-400 transition
              hover:border-white/20 hover:text-white"
          >
            <IconClose />
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-blood-600/40 bg-blood-700/10 px-4 py-3 text-sm text-blood-300">
            {error}
          </p>
        )}

        <ul className="mt-5 space-y-2">
          {DISTRICTS.map((district) => {
            const here = district.id === vehicle.districtId;
            const selected = destination === district.id;

            return (
              <li key={district.id}>
                <button
                  type="button"
                  disabled={here || moving}
                  onClick={() => setDestination(district.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                    selected
                      ? 'border-blood-600/50 bg-blood-700/12'
                      : here
                        ? 'border-white/[0.06] bg-white/[0.01] opacity-50'
                        : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14]'
                  }`}
                >
                  <IconMap className="h-4 w-4 shrink-0 text-steel-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-white">
                      {district.name}
                    </span>
                    <span className="block truncate text-xs text-steel-500">
                      {here ? 'Kjøretøyet står her' : district.tagline}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => destination && onMove(vehicle.id, destination)}
            disabled={!destination || moving}
            className="btn-primary flex-1"
          >
            {moving ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Kjører ...
              </>
            ) : (
              'Kjør dit'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
