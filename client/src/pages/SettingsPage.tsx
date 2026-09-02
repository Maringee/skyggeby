import { formatDateTime } from '@skyggeby/shared';
import { ComingSoon } from '@/components/ComingSoon';
import { IconSettings } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/state/AuthContext';

export function SettingsPage() {
  const { player, logout } = useAuth();
  if (!player) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Innstillinger"
        title="Oppsett"
        intro="Kontoen din og hvordan spillet oppfører seg."
      />

      <section className="panel panel-edge animate-fade-up p-6">
        <h2 className="font-display text-xl tracking-[0.16em] text-white">KONTO</h2>

        <dl className="mt-4 divide-y divide-white/[0.05]">
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="label-xs">Brukernavn</dt>
            <dd className="text-sm font-semibold text-white">{player.username}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="label-xs">Opprettet</dt>
            <dd className="font-mono text-sm text-steel-300">
              {formatDateTime(player.createdAt)}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => void logout()}
          className="btn-ghost mt-5 w-full sm:w-auto"
        >
          Logg ut
        </button>
      </section>

      <ComingSoon
        icon={<IconSettings className="h-6 w-6" />}
        title="Flere innstillinger"
        body="Foreløpig er det ikke mer å skru på. Etter hvert kan du styre varsler, personvern og hvordan spillet ser ut."
        planned={[
          'Bytte passord',
          'Varslingsvalg',
          'Visnings- og språkvalg',
        ]}
      />
    </div>
  );
}
