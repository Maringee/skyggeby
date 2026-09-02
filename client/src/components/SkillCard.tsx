import { useState } from 'react';
import type { SkillDto } from '@skyggeby/shared';
import {
  IconBank,
  IconChevron,
  IconMap,
  IconSearch,
  IconShield,
  IconTarget,
  IconUser,
} from './Icons';

interface SkillCardProps {
  skill: SkillDto;
  busy: boolean;
  anyBusy: boolean;
  onUpgrade: (skillId: string) => void;
  delay: number;
}

const SKILL_ICONS: Record<string, typeof IconSearch> = {
  etterretning: IconSearch,
  kriminalitet: IconTarget,
  forretning: IconBank,
  mobilitet: IconMap,
  sosial: IconUser,
  motstandskraft: IconShield,
};

/** Segmented level bar — 25 notches is too many, so it groups into 5 blocks. */
function LevelBar({ level, maxLevel }: { level: number; maxLevel: number }) {
  const segments = 20;
  const filled = Math.round((level / maxLevel) * segments);

  return (
    <div className="flex gap-[3px]" aria-hidden="true">
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          className={`h-2 flex-1 rounded-[1px] transition-colors ${
            i < filled
              ? 'bg-gradient-to-b from-blood-500 to-blood-700'
              : 'bg-ink-750'
          }`}
        />
      ))}
    </div>
  );
}

export function SkillCard({ skill, busy, anyBusy, onUpgrade, delay }: SkillCardProps) {
  const [confirming, setConfirming] = useState(false);
  const Icon = SKILL_ICONS[skill.id] ?? IconShield;

  return (
    <article
      className={`panel group relative animate-fade-up overflow-hidden p-5 transition
        ${skill.atMax ? 'border-violet-500/35' : 'hover:border-white/[0.14]'}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border
              ${
                skill.level > 0
                  ? 'border-blood-600/40 bg-blood-700/15 text-blood-400'
                  : 'border-white/[0.08] bg-white/[0.02] text-steel-500'
              }`}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-lg tracking-[0.14em] text-white">
              {skill.name.toUpperCase()}
            </h3>
            <p className="label-xs mt-0.5">{skill.focus}</p>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-lg font-semibold tabular-nums text-white">
            {skill.level}
            <span className="text-sm text-steel-500">/{skill.maxLevel}</span>
          </p>
          {skill.dormant && (
            <span className="mt-0.5 inline-block rounded border border-violet-600/40 bg-violet-700/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-violet-400">
              Snart
            </span>
          )}
        </div>
      </div>

      <div className="mt-4">
        <LevelBar level={skill.level} maxLevel={skill.maxLevel} />
      </div>

      <p className="mt-4 text-sm leading-relaxed text-steel-400">{skill.description}</p>

      <dl className="mt-4 space-y-2 border-t border-white/[0.05] pt-3">
        <div>
          <dt className="label-xs">Nå</dt>
          <dd className="mt-0.5 text-sm text-steel-300">{skill.currentEffect}</dd>
        </div>
        {skill.nextEffect && (
          <div>
            <dt className="label-xs">Neste nivå</dt>
            <dd className="mt-0.5 text-sm text-violet-400">{skill.nextEffect}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4">
        {confirming ? (
          <div className="animate-fade-in rounded-lg border border-violet-500/40 bg-violet-700/12 p-3">
            <p className="text-sm text-white">
              Øke {skill.name} fra nivå {skill.level} til nivå {skill.level + 1}?
            </p>
            <p className="mt-1 text-xs text-steel-400">Du bruker 1 ferdighetspoeng.</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onUpgrade(skill.id);
                }}
                disabled={anyBusy}
                className="btn-primary flex-1 py-2.5 text-xs"
              >
                Bekreft
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn-ghost flex-1 py-2.5 text-xs"
              >
                Avbryt
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!skill.canUpgrade || anyBusy}
              className={`btn w-full ${
                skill.canUpgrade
                  ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow hover:from-blood-500 hover:to-blood-400'
                  : 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
              }`}
            >
              {busy ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Oppgraderer ...
                </>
              ) : skill.atMax ? (
                'Maks nivå'
              ) : (
                <>
                  + Oppgrader
                  <IconChevron className="h-4 w-4" />
                </>
              )}
            </button>
            {skill.blockedText && !skill.atMax && (
              <p className="mt-2 text-center text-xs text-steel-500">{skill.blockedText}</p>
            )}
          </>
        )}
      </div>
    </article>
  );
}
