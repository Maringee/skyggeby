import { resolveDistrict } from '@skyggeby/shared';
import type { MoveResponse } from '@skyggeby/shared';
import { CityPanel } from '@/components/CityPanel';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/state/AuthContext';

export function CityPage() {
  const { player, setPlayer } = useAuth();
  if (!player) return null;

  const current = resolveDistrict(player.currentDistrictId);

  const handleMoved = (result: MoveResponse) => {
    // The server decides where the player ended up; we just mirror it.
    setPlayer(result.player);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Byen"
        title="Skyggeby"
        intro="Seks strøk, seks ulike måter å bli tatt på. Hvor du står avgjør hvordan jobbene går."
        aside={
          <span className="rounded-lg border border-blood-600/40 bg-blood-700/12 px-3 py-2 text-sm">
            <span className="label-xs mr-2">Posisjon</span>
            <span className="font-semibold text-blood-400">{current.name}</span>
          </span>
        }
      />

      <CityPanel player={player} onMoved={handleMoved} />
    </div>
  );
}
