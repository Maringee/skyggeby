import type { DistrictStateDto } from '@skyggeby/shared';
import { IconChevron, IconTarget } from './Icons';

interface DistrictCardProps {
  district: DistrictStateDto;
  selected: boolean;
  busy: boolean;
  anyBusy: boolean;
  onSelect: (districtId: string) => void;
  onMove: (districtId: string) => void;
  delay: number;
}

/** Five dots, filled up to the rating. */
function RatingDots({ value, tone }: { value: number; tone: string }) {
  return (
    <span className="flex gap-[3px]">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < value ? tone : 'bg-ink-700'}`}
        />
      ))}
    </span>
  );
}

function Rating({
  label,
  value,
  text,
  tone,
}: {
  label: string;
  value: number;
  text: string;
  tone: string;
}) {
  return (
    <div>
      <dt className="label-xs">{label}</dt>
      <dd className="mt-1 flex items-center gap-2">
        <RatingDots value={value} tone={tone} />
        <span className="text-[0.7rem] text-steel-400">{text}</span>
      </dd>
    </div>
  );
}

export function DistrictCard({
  district,
  selected,
  busy,
  anyBusy,
  onSelect,
  onMove,
  delay,
}: DistrictCardProps) {
  return (
    <article
      onClick={() => onSelect(district.id)}
      className={`panel group relative animate-fade-up cursor-pointer overflow-hidden p-5 transition
        ${district.current ? 'border-blood-600/45 shadow-glow' : 'hover:border-white/[0.14]'}
        ${selected && !district.current ? 'border-violet-500/45' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {district.current && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blood-600/[0.09] to-transparent" />
      )}

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg tracking-[0.14em] text-white">
              {district.name.toUpperCase()}
            </h3>
            <p className="label-xs mt-0.5">{district.tagline}</p>
          </div>

          {district.current && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-blood-600/45 bg-blood-700/15 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-blood-400">
              <IconTarget className="h-3 w-3" />
              Du er her
            </span>
          )}
        </div>

        <p className="mt-3 text-sm leading-relaxed text-steel-400">{district.description}</p>

        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/[0.05] pt-3">
          <Rating
            label="Politi"
            value={district.policePresence}
            text={district.policeLabel}
            tone="bg-blood-500"
          />
          <Rating
            label="Risiko"
            value={district.risk}
            text={district.riskLabel}
            tone="bg-amber"
          />
          <Rating
            label="Aktivitet"
            value={district.activity}
            text={district.activityLabel}
            tone="bg-violet-500"
          />
        </dl>

        {district.effects.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {district.effects.map((effect) => {
              const positive = effect.startsWith('+');
              const good =
                (positive && /sjanse|utbytte|XP/.test(effect)) ||
                (!positive && /heat|tap|skade/.test(effect));

              return (
                <li
                  key={effect}
                  className={`rounded-md border px-2 py-1 font-mono text-[0.68rem] ${
                    good
                      ? 'border-emerald-500/30 bg-emerald-600/10 text-neon'
                      : 'border-blood-600/35 bg-blood-700/10 text-blood-400'
                  }`}
                >
                  {effect}
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onMove(district.id);
          }}
          disabled={district.current || anyBusy}
          className={`btn mt-4 w-full ${
            district.current
              ? 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
              : 'border border-violet-600/40 bg-violet-700/15 text-violet-400 hover:border-violet-500/70 hover:bg-violet-700/25'
          }`}
        >
          {busy ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Flytter ...
            </>
          ) : district.current ? (
            'Du oppholder deg her'
          ) : (
            <>
              Dra hit
              <IconChevron className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </article>
  );
}
