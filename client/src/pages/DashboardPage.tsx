import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LIMITS,
  TRANSACTION_TYPE_LABELS,
  formatDuration,
  formatMoney,
  formatNumber,
  formatRelativeTime,
  formatSignedMoney,
  healthLabel,
  heatLabel,
  reputationLabel,
  resolveDistrict,
} from '@skyggeby/shared';
import type { TransactionDto } from '@skyggeby/shared';
import { api } from '@/api/endpoints';
import {
  IconBank,
  IconBolt,
  IconCash,
  IconChevron,
  IconFlame,
  IconHeart,
  IconMap,
  IconStar,
  IconTarget,
  IconUser,
} from '@/components/Icons';
import { Meter } from '@/components/Meter';
import { MissionPanel } from '@/components/MissionPanel';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { useNow } from '@/lib/useNow';
import { projectedEnergy, secondsToNextEnergy } from '@/lib/vitals';
import { useAuth } from '@/state/AuthContext';

/** How many ledger lines the "recent activity" card shows. */
const ACTIVITY_LIMIT = 5;

const QUICK_LINKS = [
  {
    to: '/gata',
    label: 'Gå til Gata',
    hint: 'Finn en jobb',
    icon: IconTarget,
    tone: 'from-blood-600 to-blood-500 text-white shadow-glow hover:from-blood-500 hover:to-blood-400',
  },
  {
    to: '/byen',
    label: 'Åpne Byen',
    hint: 'Bytt strøk',
    icon: IconMap,
    tone: 'border border-violet-600/40 bg-violet-700/15 text-violet-400 hover:border-violet-500/70 hover:bg-violet-700/25',
  },
  {
    to: '/okonomi',
    label: 'Åpne Økonomi',
    hint: 'Bank og regnskap',
    icon: IconBank,
    tone: 'border border-white/[0.08] bg-white/[0.02] text-steel-300 hover:border-white/20 hover:text-white',
  },
] as const;

/**
 * The overview. Deliberately small: it summarises state and points at the
 * category pages, and never hosts a system's full interface.
 */
export function DashboardPage() {
  const { player, refresh } = useAuth();
  const [activity, setActivity] = useState<TransactionDto[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const now = useNow(1000);

  const loadActivity = useCallback(async () => {
    try {
      const res = await api.transactions(ACTIVITY_LIMIT);
      setActivity(res.transactions);
    } catch {
      setActivity([]);
    } finally {
      setLoadingActivity(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity();
    // Re-sync with the authoritative state on mount.
    void refresh().catch(() => undefined);
  }, [loadActivity, refresh]);

  if (!player) return null;

  const district = resolveDistrict(player.currentDistrictId);
  const energy = projectedEnergy(player, now);
  const nextEnergy = secondsToNextEnergy(player, now);
  const xpPct = Math.round((player.xpIntoLevel / player.xpForLevel) * 100);
  const totalWorth = player.cash + player.bankBalance;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Oversikt"
        title={`God kveld, ${player.username}`}
        intro={`Samlet formue ${formatMoney(totalWorth)}. Byen følger med — hold heaten nede.`}
      />

      {/* Unspent skill points are worth surfacing; the system itself lives
          under Meg. */}
      {player.skillPoints > 0 && (
        <section className="panel panel-edge animate-fade-up flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blood-600/40 bg-blood-700/15 text-blood-400">
              <IconUser className="h-5 w-5" />
            </span>
            <div>
              <p className="label-xs">Ferdighetspoeng</p>
              <p className="font-mono text-lg font-semibold text-white">
                {player.skillPoints}
              </p>
            </div>
          </div>
          <Link to="/meg/ferdigheter" className="btn-secondary">
            Se ferdigheter
            <IconChevron className="h-4 w-4" />
          </Link>
        </section>
      )}

      {/* Quick actions */}
      <section className="grid animate-fade-up gap-3 sm:grid-cols-3">
        {QUICK_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`btn justify-between bg-gradient-to-r ${link.tone}`}
            >
              <span className="flex items-center gap-2.5">
                <Icon className="h-4 w-4" />
                <span className="text-left">
                  <span className="block">{link.label}</span>
                  <span className="block text-[0.6rem] font-normal normal-case tracking-normal opacity-70">
                    {link.hint}
                  </span>
                </span>
              </span>
              <IconChevron className="h-4 w-4" />
            </Link>
          );
        })}
      </section>

      {/* Money and progression */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Kontanter"
          value={formatMoney(player.cash)}
          accent="green"
          icon={<IconCash />}
          delay={0}
        />
        <StatCard
          label="Bank"
          value={formatMoney(player.bankBalance)}
          accent="violet"
          icon={<IconBank />}
          delay={60}
        />
        <StatCard
          label="Nivå"
          value={String(player.level)}
          sub={`${formatNumber(player.xpIntoLevel)} / ${formatNumber(player.xpForLevel)} XP`}
          accent="red"
          icon={<IconStar />}
          delay={120}
        >
          <Meter value={player.xpIntoLevel} max={player.xpForLevel} tone="red" hint={`${xpPct} %`} />
        </StatCard>
        <StatCard
          label="Energi"
          value={`${energy} / ${player.maxEnergy}`}
          sub={nextEnergy === null ? 'Full tank.' : `Neste om ${formatDuration(nextEnergy)}`}
          accent="violet"
          icon={<IconBolt />}
          delay={180}
        >
          <Meter value={energy} max={player.maxEnergy} tone="violet" />
        </StatCard>
      </section>

      {/* Condition */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Helse"
          value={`${player.health} / ${LIMITS.maxHealth}`}
          sub={healthLabel(player.health)}
          accent="green"
          icon={<IconHeart />}
          delay={220}
        >
          <Meter value={player.health} max={LIMITS.maxHealth} tone="green" />
        </StatCard>
        <StatCard
          label="Heat"
          value={`${player.heat} / ${LIMITS.maxHeat}`}
          sub={heatLabel(player.heat)}
          accent="red"
          icon={<IconFlame />}
          delay={260}
        >
          <Meter value={player.heat} max={LIMITS.maxHeat} tone="amber" />
        </StatCard>
        <StatCard
          label="Respekt"
          value={formatNumber(player.reputation)}
          sub={reputationLabel(player.reputation)}
          accent="violet"
          icon={<IconStar />}
          delay={300}
        >
          <Meter value={Math.min(player.reputation, 3000)} max={3000} tone="violet" />
        </StatCard>
      </section>

      {/* What is on the go. Renders nothing when there is nothing running. */}
      <MissionPanel delay={320} />

      {/* Position + activity */}
      <section className="grid gap-4 lg:grid-cols-2">
        <article
          className="panel panel-edge animate-fade-up p-6"
          style={{ animationDelay: '340ms' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="label-xs">Nåværende posisjon</p>
              <h2 className="mt-1 font-display text-2xl tracking-[0.14em] text-white">
                {district.name.toUpperCase()}
              </h2>
              <p className="mt-0.5 text-xs text-steel-500">{district.tagline}</p>
            </div>
            <IconMap className="h-5 w-5 shrink-0 text-blood-500" />
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/[0.05] pt-3">
            <div>
              <dt className="label-xs">Politi</dt>
              <dd className="mt-0.5 font-mono text-sm text-steel-300">
                {district.policePresence} / 5
              </dd>
            </div>
            <div>
              <dt className="label-xs">Risiko</dt>
              <dd className="mt-0.5 font-mono text-sm text-steel-300">{district.risk} / 5</dd>
            </div>
            <div>
              <dt className="label-xs">Aktivitet</dt>
              <dd className="mt-0.5 font-mono text-sm text-steel-300">{district.activity} / 5</dd>
            </div>
          </dl>

          <Link to="/byen" className="btn-ghost mt-4 w-full">
            Se hele byen
            <IconChevron className="h-4 w-4" />
          </Link>
        </article>

        <article
          className="panel panel-edge animate-fade-up p-6"
          style={{ animationDelay: '380ms' }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-xl tracking-[0.16em] text-white">
              SISTE AKTIVITET
            </h2>
            <Link
              to="/okonomi"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-steel-400 transition hover:text-blood-400"
            >
              Alt
            </Link>
          </div>

          <div className="mt-4">
            {loadingActivity ? (
              <ul className="space-y-2" aria-busy="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="h-10 animate-pulse-soft rounded-lg bg-ink-850/70" />
                ))}
              </ul>
            ) : activity.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/[0.08] px-4 py-6 text-center text-sm text-steel-500">
                Ingenting har skjedd ennå. Ta en tur ut på gata.
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {activity.map((tx) => (
                  <li key={tx.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">
                        {tx.description ?? TRANSACTION_TYPE_LABELS[tx.type]}
                      </p>
                      <p className="text-[0.68rem] text-steel-500">
                        {formatRelativeTime(tx.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
                        tx.amount > 0 ? 'text-neon' : 'text-blood-400'
                      }`}
                    >
                      {formatSignedMoney(tx.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
