import { Link } from 'react-router-dom';
import { formatDuration, resolveDistrict } from '@skyggeby/shared';
import type { CrimeActionResponse } from '@skyggeby/shared';
import { CrimePanel } from '@/components/CrimePanel';
import { GataTabs } from '@/components/GataTabs';
import { IconBolt } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { useNow } from '@/lib/useNow';
import { projectedEnergy, secondsToNextEnergy } from '@/lib/vitals';
import { useAuth } from '@/state/AuthContext';

export function StreetPage() {
  const { player, setPlayer } = useAuth();
  const now = useNow(1000);

  if (!player) return null;

  const district = resolveDistrict(player.currentDistrictId);
  const energy = projectedEnergy(player, now);
  const nextEnergy = secondsToNextEnergy(player, now);

  const handleOutcome = (result: CrimeActionResponse) => {
    // The response is the new truth: money, XP, level, heat and health all come
    // straight from the server.
    setPlayer(result.player);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Gata"
        title="Jobber"
        intro="Serveren avgjør hvert utfall. Tallene under gjelder der du står nå."
        aside={
          <div className="flex items-center gap-2">
            <Link
              to="/byen"
              className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-steel-300 transition hover:border-violet-500/50 hover:text-white"
            >
              <span className="label-xs mr-2">Strøk</span>
              <span className="font-semibold text-violet-400">{district.name}</span>
            </Link>
            <span
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2 text-violet-400"
              title={
                nextEnergy === null
                  ? 'Full energi'
                  : `Neste energipoeng om ${formatDuration(nextEnergy)}`
              }
            >
              <IconBolt className="h-4 w-4" />
              <span className="font-mono text-sm font-semibold tabular-nums">
                {energy} / {player.maxEnergy}
              </span>
            </span>
          </div>
        }
      />

      <GataTabs />

      <CrimePanel player={player} onOutcome={handleOutcome} />
    </div>
  );
}
