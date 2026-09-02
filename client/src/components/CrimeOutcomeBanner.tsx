import { formatDuration, formatMoney, formatNumber } from '@skyggeby/shared';
import type { CrimeOutcomeDto } from '@skyggeby/shared';

interface Chip {
  label: string;
  value: string;
  tone: 'good' | 'bad' | 'neutral';
}

const TONE_CLASSES: Record<Chip['tone'], string> = {
  good: 'border-emerald-500/35 bg-emerald-600/10 text-neon',
  bad: 'border-blood-600/40 bg-blood-700/12 text-blood-400',
  neutral: 'border-white/[0.08] bg-white/[0.02] text-steel-300',
};

function buildChips(outcome: CrimeOutcomeDto): Chip[] {
  const chips: Chip[] = [];

  if (outcome.payout > 0) {
    chips.push({ label: 'Utbytte', value: formatMoney(outcome.payout), tone: 'good' });
  }
  if (outcome.fine > 0) {
    chips.push({ label: 'Tap', value: `−${formatMoney(outcome.fine)}`, tone: 'bad' });
  }
  if (outcome.xpGained > 0) {
    chips.push({
      label: 'Erfaring',
      value: `+${formatNumber(outcome.xpGained)} XP`,
      tone: 'good',
    });
  }
  if (outcome.heatChange !== 0) {
    chips.push({
      label: 'Heat',
      value: `${outcome.heatChange > 0 ? '+' : '−'}${Math.abs(outcome.heatChange)}`,
      tone: outcome.heatChange > 0 ? 'bad' : 'good',
    });
  }
  if (outcome.healthChange !== 0) {
    chips.push({
      label: 'Helse',
      value: `${outcome.healthChange > 0 ? '+' : '−'}${Math.abs(outcome.healthChange)}`,
      tone: outcome.healthChange < 0 ? 'bad' : 'good',
    });
  }

  chips.push({
    label: 'Energi',
    value: `−${outcome.energySpent}`,
    tone: 'neutral',
  });
  chips.push({
    label: 'Avkjøling',
    value: formatDuration(outcome.cooldownSeconds),
    tone: 'neutral',
  });

  return chips;
}

export function CrimeOutcomeBanner({ outcome }: { outcome: CrimeOutcomeDto }) {
  const chips = buildChips(outcome);

  return (
    <div
      key={outcome.performedAt}
      className={`animate-fade-up rounded-xl border p-5 ${
        outcome.success
          ? 'border-emerald-500/30 bg-emerald-600/[0.07]'
          : 'border-blood-600/35 bg-blood-700/[0.09]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              outcome.success ? 'bg-neon' : 'bg-blood-500'
            } animate-pulse-soft`}
          />
          <h3
            className={`font-display text-lg tracking-[0.18em] ${
              outcome.success ? 'text-neon' : 'text-blood-400'
            }`}
          >
            {outcome.headline.toUpperCase()}
          </h3>
        </div>
        <p className="label-xs">
          {outcome.crimeName} · {outcome.districtName}
        </p>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-steel-300">{outcome.story}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={`${chip.label}-${chip.value}`}
            className={`rounded-md border px-2.5 py-1.5 text-xs ${TONE_CLASSES[chip.tone]}`}
          >
            <span className="mr-1.5 text-steel-500">{chip.label}</span>
            <span className="font-mono font-semibold">{chip.value}</span>
          </span>
        ))}
      </div>

      {outcome.information && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2.5 text-sm ${
            outcome.information.bonusApplied > 0
              ? 'border-violet-500/40 bg-violet-700/12 text-violet-400'
              : 'border-white/[0.08] bg-white/[0.02] text-steel-400'
          }`}
        >
          <span className="label-xs mr-2">{outcome.information.typeLabel}</span>
          <span className="font-semibold text-white">{outcome.information.title}</span>
          <p className="mt-1 text-xs leading-relaxed">{outcome.information.note}</p>
        </div>
      )}

      {outcome.leveledUp && (
        <p className="mt-4 rounded-lg border border-violet-500/40 bg-violet-700/15 px-3 py-2.5 text-sm text-violet-400">
          <span className="font-display tracking-[0.16em] text-white">NYTT NIVÅ </span>
          Du er nå nivå {outcome.newLevel}.
          {outcome.skillPointsGained > 0
            ? ` Du fikk ${outcome.skillPointsGained} ferdighetspoeng.`
            : ' Nye muligheter kan ha åpnet seg.'}
        </p>
      )}
    </div>
  );
}
