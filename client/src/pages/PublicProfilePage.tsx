import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDateTime, formatNumber } from '@skyggeby/shared';
import type { PublicProfileDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { IconBank, IconBuilding, IconMail, IconMap, IconStar, IconUser } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';

/**
 * Another player, as the city sees them.
 *
 * Everything here comes from the public profile endpoint. The page has no way
 * to ask for anything else - money, health and heat are not in the payload at
 * all, so there is nothing to accidentally render.
 */
export function PublicProfilePage() {
  const { username = '' } = useParams();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<PublicProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.playerProfile(username);
      setProfile(res.profile);
      setError(null);
    } catch (err) {
      setProfile(null);
      setError(
        err instanceof ApiError ? err.message : 'Kunne ikke hente denne spilleren.',
      );
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-20 animate-pulse-soft rounded-xl bg-ink-850/70" />
        <div className="h-64 animate-pulse-soft rounded-xl bg-ink-850/70" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Spiller" title="Ukjent spiller" />
        <section className="panel panel-edge animate-fade-up p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-violet-600/30 bg-violet-700/10 text-violet-400">
            <IconUser className="h-6 w-6" />
          </div>
          <p className="text-sm text-steel-400">{error ?? 'Fant ikke denne spilleren.'}</p>
          <Link to="/meg" className="btn-secondary mt-5">
            Tilbake til Meg
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Spiller"
        title={profile.username}
        intro={`Medlem av byen siden ${formatDateTime(profile.memberSince)}.`}
        aside={
          <span className="rounded-lg border border-blood-600/40 bg-blood-700/12 px-3 py-2 text-sm">
            <span className="label-xs mr-2">Nivå</span>
            <span className="font-mono font-semibold text-blood-400">{profile.level}</span>
          </span>
        }
      />

      <section className="panel panel-edge animate-fade-up p-6">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-violet-600/35 bg-violet-700/12 text-violet-400">
            <IconUser className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl tracking-[0.12em] text-white">
              {profile.username.toUpperCase()}
            </p>
            <p className="mt-1 text-sm text-steel-400">
              Nivå {profile.level} · {formatNumber(profile.xp)} XP
            </p>
          </div>

          {/* You do not write letters to yourself. */}
          {!profile.isSelf && (
            <button
              type="button"
              onClick={() =>
                navigate('/meldinger', {
                  state: { recipient: { id: profile.id, username: profile.username } },
                })
              }
              className="btn-primary w-full sm:w-auto"
            >
              <IconMail className="h-4 w-4" />
              Send melding
            </button>
          )}
          {profile.isSelf && (
            <Link to="/meg" className="btn-ghost w-full sm:w-auto">
              Dette er deg
            </Link>
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Rykte"
          value={formatNumber(profile.reputation)}
          sub={profile.reputationLabel}
          accent="violet"
          icon={<IconStar />}
          delay={0}
        />
        <StatCard
          label="Distrikt"
          value={profile.districtName}
          sub="Der spilleren befinner seg nå"
          accent="red"
          icon={<IconMap />}
          delay={60}
        />
        <StatCard
          label="Virksomheter"
          value={formatNumber(profile.businessCount)}
          sub="Antall drevne virksomheter"
          accent="green"
          icon={<IconBuilding />}
          delay={120}
        />
        <StatCard
          label="Eiendeler"
          value={formatNumber(profile.assetCount)}
          sub="Antall eide ting"
          accent="steel"
          icon={<IconBank />}
          delay={180}
        />
      </section>

      <p className="text-xs text-steel-500">
        Offentlig profil. Kontanter, helse og heat er spillerens egen sak.
      </p>
    </div>
  );
}
