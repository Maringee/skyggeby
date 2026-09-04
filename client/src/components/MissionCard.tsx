import type { MissionDto } from '@skyggeby/shared';
import { formatDuration, formatMoney } from '@skyggeby/shared';
import { IconCheck, IconClock, IconLock } from './Icons';

interface MissionCardProps {
  mission: MissionDto;
  busy: boolean;
  onAccept?: (missionId: string) => void;
  onDeliver?: (missionId: string) => void;
  onAbandon?: (missionId: string) => void;
}

/** A ticked or crossed line, with the player's own value beside it. */
function ConditionRow({
  met,
  label,
  actual,
}: {
  met: boolean;
  label: string;
  actual: string;
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-start gap-2">
        <span
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            met
              ? 'border-neon/40 bg-neon/10 text-neon'
              : 'border-white/10 bg-white/[0.03] text-steel-500'
          }`}
          aria-hidden="true"
        >
          {met ? <IconCheck className="h-2.5 w-2.5" /> : null}
        </span>
        <span className={`text-sm ${met ? 'text-steel-300' : 'text-white'}`}>{label}</span>
      </span>

      <span className={`shrink-0 font-mono text-xs ${met ? 'text-neon' : 'text-steel-400'}`}>
        {actual}
      </span>
    </li>
  );
}

/**
 * One mission.
 *
 * The checklist is the whole interface: every objective shows what is asked and
 * what the player actually has, so nobody has to guess what is missing. The
 * button is only ever a request - a disabled one is politeness, and the server
 * decides either way.
 */
export function MissionCard({
  mission,
  busy,
  onAccept,
  onDeliver,
  onAbandon,
}: MissionCardProps) {
  const active = mission.availability === 'AKTIV';
  const locked = mission.availability === 'LAAST';
  const blocked = mission.availability === 'SPERRET';
  const done = mission.availability === 'FULLFORT';

  const rewards = mission.rewards;

  // Built as a list rather than a chain of conditionals, so a mission that pays
  // nothing in one currency does not leave a dangling separator behind.
  const rewardParts: Array<{ text: string; tone: string }> = [];
  if (rewards.cash > 0) {
    rewardParts.push({ text: formatMoney(rewards.cash), tone: 'font-mono text-neon' });
  }
  if (rewards.xp > 0) rewardParts.push({ text: `${rewards.xp} XP`, tone: 'font-mono' });
  if (rewards.trust > 0) {
    rewardParts.push({ text: `+${rewards.trust} tillit`, tone: 'font-mono' });
  }
  if (rewards.heatChange < 0) {
    rewardParts.push({ text: `${rewards.heatChange} heat`, tone: 'font-mono text-neon' });
  }
  if (rewards.information) rewardParts.push({ text: 'informasjon', tone: '' });

  const hasReward = rewardParts.length > 0;

  return (
    <article
      className={`panel animate-fade-up p-5 ${active ? 'border-violet-500/25' : ''} ${
        done ? 'opacity-70' : ''
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-display text-base tracking-[0.1em] text-white">
            {(locked || blocked) && <IconLock className="h-3.5 w-3.5 text-steel-500" />}
            {mission.name}
          </h3>
          <p className="mt-1 text-xs text-steel-500">
            <span className="text-steel-300">{mission.contactName}</span>
            {mission.contactTypeLabel ? ` · ${mission.contactTypeLabel}` : ''} ·{' '}
            <span className="text-violet-400">{mission.districtName}</span> ·{' '}
            {mission.categoryLabel}
          </p>
        </div>

        <span className="label-xs shrink-0 rounded-md border border-white/[0.08] px-2 py-1">
          Nivå {mission.minLevel}
        </span>
      </header>

      {/* What the contact says. Their voice, not the game's. */}
      <p className="mt-4 border-l-2 border-white/[0.08] pl-3 text-sm italic text-steel-300">
        {mission.briefing}
      </p>

      {done && mission.debriefing && (
        <p className="mt-3 border-l-2 border-neon/30 pl-3 text-sm italic text-steel-400">
          {mission.debriefing}
        </p>
      )}

      {mission.objectives.length > 0 && !done && (
        <ul className="mt-4 divide-y divide-white/[0.04]">
          {mission.objectives.map((objective, index) => (
            <ConditionRow
              key={`${objective.kind}-${index}`}
              met={objective.met}
              label={objective.label}
              actual={objective.actual}
            />
          ))}
        </ul>
      )}

      {/* Why it cannot be taken, when that is the situation. */}
      {(locked || blocked) && mission.conditions.some((c) => !c.met) && (
        <ul className="mt-4 divide-y divide-white/[0.04]">
          {mission.conditions
            .filter((condition) => !condition.met)
            .map((condition, index) => (
              <ConditionRow
                key={index}
                met={false}
                label={condition.label}
                actual={condition.actual}
              />
            ))}
        </ul>
      )}

      {blocked && mission.blockedSeconds > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-steel-500">
          <IconClock className="h-3.5 w-3.5" />
          Åpner igjen om {formatDuration(mission.blockedSeconds)}
        </p>
      )}

      {active && mission.expiresAt && mission.blockedSeconds > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-blood-400">
          <IconClock className="h-3.5 w-3.5" />
          Fristen går ut om {formatDuration(mission.blockedSeconds)}
        </p>
      )}

      {!done && (
        <div className="mt-4 border-t border-white/[0.06] pt-3">
          {mission.rewardsHidden ? (
            <p className="text-xs text-steel-500">
              Hva dette betaler får du vite når {mission.contactName} stoler nok på deg.
            </p>
          ) : (
            hasReward && (
              <p className="text-xs text-steel-400">
                <span className="label-xs mr-2">Betaler</span>
                {rewardParts.map((part, index) => (
                  <span key={part.text}>
                    {index > 0 && <span className="text-steel-600"> · </span>}
                    <span className={part.tone}>{part.text}</span>
                  </span>
                ))}
              </p>
            )
          )}

          {(rewards.unlocksMissions.length > 0 || rewards.unlocksContacts.length > 0) && (
            <p className="mt-1.5 text-xs text-violet-400">
              Åpner: {[...rewards.unlocksContacts, ...rewards.unlocksMissions].join(', ')}
            </p>
          )}
        </div>
      )}

      {(active || mission.availability === 'TILGJENGELIG') && (
        <div className="mt-4 flex flex-wrap gap-2">
          {mission.availability === 'TILGJENGELIG' && onAccept && (
            <button
              type="button"
              onClick={() => onAccept(mission.id)}
              disabled={busy}
              className="btn-primary flex-1 sm:flex-none sm:px-8"
            >
              Ta oppdraget
            </button>
          )}

          {active && onDeliver && (
            <button
              type="button"
              onClick={() => onDeliver(mission.id)}
              disabled={busy || !mission.deliverable}
              className="btn-primary flex-1 sm:flex-none sm:px-8"
              title={mission.deliverable ? undefined : (mission.blockedReason ?? undefined)}
            >
              Lever
            </button>
          )}

          {active && onAbandon && (
            <button
              type="button"
              onClick={() => onAbandon(mission.id)}
              disabled={busy}
              className="btn-ghost"
            >
              Avbryt
            </button>
          )}
        </div>
      )}

      {active && !mission.deliverable && mission.blockedReason && (
        <p className="mt-3 text-xs text-steel-500">{mission.blockedReason}</p>
      )}
    </article>
  );
}
