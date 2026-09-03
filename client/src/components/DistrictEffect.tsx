import { districtModifiers, resolveDistrict } from '@skyggeby/shared';
import { IconMap } from './Icons';

interface DistrictEffectProps {
  districtId: string;
}

/** A multiplier rendered as the percentage difference a player actually feels. */
function delta(multiplier: number): { text: string; tone: string } {
  const pct = Math.round((multiplier - 1) * 100);
  if (pct === 0) return { text: '±0 %', tone: 'text-steel-400' };
  return {
    text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)} %`,
    tone: pct > 0 ? 'text-neon' : 'text-blood-400',
  };
}

/**
 * What the district the player is standing in does to the numbers.
 *
 * The server has always applied these - the odds and payouts in the list are
 * already adjusted - but nothing said so, which made moving around the city
 * look like flavour rather than a decision. This is that arithmetic, shown.
 *
 * Derived from the shared catalogue rather than a new API field: the client can
 * read a district's ratings, and the server remains the only party that applies
 * them to an actual roll.
 */
export function DistrictEffect({ districtId }: DistrictEffectProps) {
  const district = resolveDistrict(districtId);
  const modifiers = districtModifiers(district);

  const rows: Array<{ label: string; multiplier: number; higherIsBetter: boolean }> = [
    { label: 'Sjanse', multiplier: modifiers.success, higherIsBetter: true },
    { label: 'Utbytte', multiplier: modifiers.payout, higherIsBetter: true },
    { label: 'XP', multiplier: modifiers.xp, higherIsBetter: true },
    { label: 'Heat', multiplier: modifiers.heat, higherIsBetter: false },
  ];

  return (
    <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="flex items-center gap-1.5 text-xs text-steel-400">
        <IconMap className="h-3.5 w-3.5 text-steel-500" />
        Slik slår <span className="font-semibold text-violet-400">{district.name}</span> ut
        på jobbene under
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map((row) => {
          const shown = delta(row.multiplier);
          // A rise in heat is bad news, so the colour follows the consequence
          // rather than the sign.
          const tone = row.higherIsBetter
            ? shown.tone
            : shown.text.startsWith('+')
              ? 'text-blood-400'
              : shown.text.startsWith('−')
                ? 'text-neon'
                : 'text-steel-400';

          return (
            <div key={row.label}>
              <dt className="label-xs">{row.label}</dt>
              <dd className={`mt-0.5 font-mono text-sm font-semibold ${tone}`}>
                {shown.text}
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="mt-3 text-[0.68rem] text-steel-500">
        Et roligere strøk gir bedre odds, et travlere gir mer betalt. Bytt strøk under
        Byen for å endre regnestykket.
      </p>
    </section>
  );
}
