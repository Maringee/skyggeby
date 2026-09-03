import {
  findCrime,
  formatDuration,
  formatMoney,
  resolveCrimeBlock,
} from '@skyggeby/shared';
import type { CrimeStateDto, PlayerDto } from '@skyggeby/shared';
import { projectedEnergy } from '@/lib/vitals';
import { IconBolt, IconChevron, IconClock, IconLock } from './Icons';

interface CrimeCardProps {
  crime: CrimeStateDto;
  player: PlayerDto;
  /** Current wall clock, ticked once per second by the panel. */
  now: number;
  busy: boolean;
  /** True while any crime request is in flight. */
  anyBusy: boolean;
  onCommit: (crimeId: string) => void;
  delay: number;
}

function riskTone(chance: number): string {
  if (chance >= 0.8) return 'text-neon';
  if (chance >= 0.62) return 'text-emerald-400';
  if (chance >= 0.45) return 'text-amber';
  if (chance >= 0.28) return 'text-orange-400';
  return 'text-blood-400';
}

export function CrimeCard({
  crime,
  player,
  now,
  busy,
  anyBusy,
  onCommit,
  delay,
}: CrimeCardProps) {
  const definition = findCrime(crime.id);

  // Cooldown and energy both move on their own between requests, so the card
  // recomputes its own state each tick instead of trusting the last response.
  const cooldownRemaining = crime.cooldownUntil
    ? Math.max(0, Math.ceil((new Date(crime.cooldownUntil).getTime() - now) / 1000))
    : 0;

  const energy = projectedEnergy(player, now);

  const block = definition
    ? resolveCrimeBlock(definition, {
        level: player.level,
        energy,
        health: player.health,
        cooldownRemainingSeconds: cooldownRemaining,
      })
    : { reason: crime.blockedReason, text: crime.blockedText };

  const locked = player.level < crime.minLevel;
  const available = block.reason === null;
  const chancePct = Math.round(crime.successChance * 100);

  // The list already arrives adjusted for the district and the player's heat.
  // Showing the gap against the catalogue's base makes that visible, so moving
  // around the city reads as a decision rather than as scenery.
  const basePct = Math.round(crime.baseSuccessChance * 100);
  const chanceDelta = chancePct - basePct;

  return (
    <article
      className={`panel group relative animate-fade-up overflow-hidden p-5 transition
        ${locked ? 'opacity-55' : 'hover:border-white/[0.14]'}
        ${available ? 'border-white/[0.07]' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Cooldown wash */}
      {cooldownRemaining > 0 && !locked && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-violet-700/10 transition-[width] duration-1000"
          style={{
            width: `${Math.min(100, (cooldownRemaining / crime.cooldownSeconds) * 100)}%`,
          }}
        />
      )}

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {locked && <IconLock className="h-3.5 w-3.5 text-steel-500" />}
              <h3 className="font-display text-lg tracking-[0.14em] text-white">
                {crime.name.toUpperCase()}
              </h3>
            </div>
            <p className="label-xs mt-0.5">{crime.scene}</p>
          </div>

          <div className="shrink-0 text-right">
            <p className={`font-mono text-sm font-semibold ${riskTone(crime.successChance)}`}>
              {chancePct} %
            </p>
            {chanceDelta !== 0 ? (
              <p
                className={`font-mono text-[0.68rem] ${
                  chanceDelta > 0 ? 'text-neon' : 'text-blood-400'
                }`}
                title={`Grunnsjanse ${basePct} %, justert for strøk og heat`}
              >
                {chanceDelta > 0 ? '+' : '−'}
                {Math.abs(chanceDelta)} pp
              </p>
            ) : (
              <p className="text-[0.68rem] text-steel-500">{crime.riskLabel}</p>
            )}
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-steel-400">{crime.description}</p>

        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/[0.05] pt-3">
          <div>
            <dt className="label-xs">Utbytte</dt>
            <dd className="mt-0.5 font-mono text-xs text-steel-300">
              {formatMoney(crime.rewardMin)} – {formatMoney(crime.rewardMax)}
            </dd>
          </div>
          <div>
            <dt className="label-xs">XP</dt>
            <dd className="mt-0.5 font-mono text-xs text-steel-300">
              {crime.xpMin} – {crime.xpMax}
            </dd>
          </div>
          <div>
            <dt className="label-xs">Krav</dt>
            <dd className="mt-0.5 flex items-center gap-2 font-mono text-xs text-steel-300">
              <span title="Nivåkrav">Nv. {crime.minLevel}</span>
              <span className="flex items-center gap-0.5 text-violet-400" title="Energikostnad">
                <IconBolt className="h-3 w-3" />
                {crime.energyCost}
              </span>
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onCommit(crime.id)}
            disabled={!available || anyBusy}
            className={`btn flex-1 ${
              available
                ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow hover:from-blood-500 hover:to-blood-400'
                : 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
            }`}
          >
            {busy ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Utfører ...
              </>
            ) : (
              <>
                Utfør
                <IconChevron className="h-4 w-4" />
              </>
            )}
          </button>

          <div className="shrink-0 text-right">
            {cooldownRemaining > 0 && !locked ? (
              <p className="flex items-center gap-1.5 font-mono text-xs text-violet-400">
                <IconClock className="h-3.5 w-3.5" />
                {formatDuration(cooldownRemaining)}
              </p>
            ) : (
              <p className="text-[0.68rem] text-steel-500">
                Avkjøling {formatDuration(crime.cooldownSeconds)}
              </p>
            )}
          </div>
        </div>

        {block.text && (
          <p className="mt-2 text-xs text-steel-500">{block.text}</p>
        )}
      </div>
    </article>
  );
}
