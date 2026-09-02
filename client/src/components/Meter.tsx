interface MeterProps {
  value: number;
  max: number;
  /** Tailwind gradient classes for the filled part. */
  tone?: 'red' | 'violet' | 'green' | 'amber';
  label?: string;
  hint?: string;
}

const TONES: Record<NonNullable<MeterProps['tone']>, string> = {
  red: 'from-blood-700 via-blood-600 to-blood-400',
  violet: 'from-violet-700 via-violet-600 to-violet-400',
  green: 'from-emerald-700 via-emerald-500 to-neon',
  amber: 'from-orange-700 via-amber to-yellow-300',
};

export function Meter({ value, max, tone = 'red', label, hint }: MeterProps) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div>
      {(label || hint) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label && <span className="label-xs">{label}</span>}
          {hint && <span className="font-mono text-xs text-steel-400">{hint}</span>}
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-750">
        <div
          className={`h-full origin-left animate-bar-grow rounded-full bg-gradient-to-r ${TONES[tone]} transition-[width] duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
