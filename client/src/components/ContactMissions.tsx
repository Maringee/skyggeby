import { Link } from 'react-router-dom';
import type { MissionDto } from '@skyggeby/shared';
import { IconCheck, IconClipboard, IconLock } from './Icons';

/**
 * The jobs one contact is offering, shown where the player meets them.
 *
 * Deliberately not a second source of truth: these are the very same
 * `MissionDto`s the mission page renders, filtered by contact. Availability,
 * blocked reasons and everything else are the server's answers - this only
 * decides where they appear.
 *
 * This is where the trust bar stops being a number. A contact you have barely
 * spoken to shows work you cannot take yet, with the reason on the line.
 */
export function ContactMissions({
  missions,
  contactName,
}: {
  missions: MissionDto[];
  contactName: string;
}) {
  if (missions.length === 0) {
    return (
      <div className="mt-5 border-t border-white/[0.06] pt-5">
        <p className="label-xs">Oppdrag</p>
        <p className="mt-2 text-sm text-steel-500">
          {contactName} har ingenting til deg akkurat nå.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-white/[0.06] pt-5">
      <p className="label-xs flex items-center gap-1.5">
        <IconClipboard className="h-3.5 w-3.5" />
        Oppdrag
      </p>

      <ul className="mt-3 space-y-2">
        {missions.map((mission) => {
          const done = mission.availability === 'FULLFORT';
          const active = mission.availability === 'AKTIV';
          const open = mission.availability === 'TILGJENGELIG';

          return (
            <li
              key={mission.id}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-start gap-2">
                  {done ? (
                    <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neon" />
                  ) : open || active ? (
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400"
                      aria-hidden="true"
                    />
                  ) : (
                    <IconLock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-steel-500" />
                  )}
                  <span
                    className={`text-sm ${done ? 'text-steel-500 line-through' : 'text-white'}`}
                  >
                    {mission.name}
                  </span>
                </span>

                <span
                  className={`shrink-0 text-xs ${
                    mission.deliverable
                      ? 'text-neon'
                      : active
                        ? 'text-violet-400'
                        : 'text-steel-500'
                  }`}
                >
                  {mission.deliverable ? 'Klart' : mission.availabilityLabel}
                </span>
              </div>

              {/* Why it is not open yet - the server's own wording, not ours. */}
              {!done && !active && mission.blockedReason && (
                <p className="mt-1.5 pl-[22px] text-xs text-steel-500">
                  {mission.blockedReason}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <Link
        to="/oppdrag"
        className="mt-3 inline-block text-xs text-violet-400 transition hover:text-violet-300"
      >
        Se alle oppdrag
      </Link>
    </div>
  );
}
