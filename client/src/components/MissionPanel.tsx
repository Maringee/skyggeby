import { Link } from 'react-router-dom';
import { IconClipboard } from './Icons';
import { useMissions } from '@/state/MissionsContext';

/**
 * The dashboard's mission panel.
 *
 * Deliberately three lines at most and no API call of its own: it reads the
 * same state the sidebar badge already keeps current, so adding it to the
 * dashboard costs one render and no round trip.
 *
 * Ready work is listed before unfinished work, because the only thing the
 * player has to act on right now is the part they can hand in.
 */
export function MissionPanel({ delay = 0 }: { delay?: number }) {
  const { active, deliverable } = useMissions();

  if (active.length === 0) return null;

  const ordered = [...active].sort(
    (a, b) => Number(b.deliverable) - Number(a.deliverable),
  );

  return (
    <article
      className="panel panel-edge animate-fade-up p-6"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-xs flex items-center gap-1.5">
            <IconClipboard className="h-3.5 w-3.5" />
            Oppdrag
          </p>
          <h2 className="mt-1 font-display text-xl tracking-[0.16em] text-white">
            {deliverable > 0
              ? `${deliverable} KLAR${deliverable === 1 ? 'T' : 'E'} TIL LEVERING`
              : 'PÅ GANG'}
          </h2>
        </div>

        <Link
          to="/oppdrag"
          className="shrink-0 text-xs text-violet-400 transition hover:text-violet-300"
        >
          Åpne
        </Link>
      </div>

      <ul className="mt-4 space-y-2">
        {ordered.map((mission) => (
          <li
            key={mission.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  mission.deliverable ? 'bg-neon' : 'bg-violet-500'
                }`}
                aria-hidden="true"
              />
              <span className="truncate text-sm text-white">{mission.name}</span>
            </span>

            <span
              className={`shrink-0 font-mono text-xs ${
                mission.deliverable ? 'text-neon' : 'text-steel-400'
              }`}
            >
              {mission.deliverable
                ? 'Klart'
                : // The one unfinished objective worth naming: the first one
                  // that is not done yet.
                  (mission.objectives.find((objective) => !objective.met)?.actual ?? '—')}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
