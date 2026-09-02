import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  INVENTORY_CAPACITY,
  LIMITS,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  healthLabel,
  heatLabel,
  reputationLabel,
  resolveDistrict,
} from '@skyggeby/shared';
import { api } from '@/api/endpoints';
import {
  IconBank,
  IconBolt,
  IconBuilding,
  IconCash,
  IconFlame,
  IconHeart,
  IconHome,
  IconMap,
  IconShield,
  IconStar,
  IconTarget,
} from '@/components/Icons';
import { SectionTabs } from '@/components/GataTabs';
import { Meter } from '@/components/Meter';
import { PageHeader } from '@/components/PageHeader';
import { PlayerSearch } from '@/components/PlayerSearch';
import { StatCard } from '@/components/StatCard';
import { useNow } from '@/lib/useNow';
import { projectedEnergy, secondsToNextEnergy } from '@/lib/vitals';
import { useAuth } from '@/state/AuthContext';

interface Holdings {
  businesses: number;
  assets: number;
  properties: number;
  carried: number;
  capacity: number;
}

/**
 * The player's own profile.
 *
 * Deliberately a summary and not a second copy of every system: each number
 * here links to the page that owns it. Holdings come from the server - the
 * public profile endpoint for the counts, the inventory endpoint for capacity -
 * rather than being added up in the browser.
 */
export function ProfilePage() {
  const { player, refresh } = useAuth();
  const now = useNow(1000);

  const [holdings, setHoldings] = useState<Holdings | null>(null);

  const username = player?.username;

  const loadHoldings = useCallback(async () => {
    if (!username) return;
    try {
      const [profile, inventory, properties] = await Promise.all([
        api.playerProfile(username),
        api.inventory(),
        // Properties are deliberately not part of the public profile, so the
        // count comes from the player's own endpoint.
        api.properties(),
      ]);
      setHoldings({
        businesses: profile.profile.businessCount,
        assets: profile.profile.assetCount,
        properties: properties.count,
        carried: inventory.usedSlots,
        capacity: inventory.capacity,
      });
    } catch {
      // The page is still useful without the summary; the sections that own
      // these numbers show them in full.
      setHoldings(null);
    }
  }, [username]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    void loadHoldings();
  }, [loadHoldings]);

  if (!player) return null;

  const energy = projectedEnergy(player, now);
  const nextEnergy = secondsToNextEnergy(player, now);
  const xpPct = Math.round((player.xpIntoLevel / player.xpForLevel) * 100);
  const district = resolveDistrict(player.currentDistrictId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meg"
        title={player.username}
        intro={`Medlem av byen siden ${formatDateTime(player.createdAt)}.`}
        aside={
          <span className="rounded-lg border border-blood-600/40 bg-blood-700/12 px-3 py-2 text-sm">
            <span className="label-xs mr-2">Nivå</span>
            <span className="font-mono font-semibold text-blood-400">{player.level}</span>
          </span>
        }
      />

      <SectionTabs section="/meg" />

      {/* Profil */}
      <section className="panel panel-edge animate-fade-up p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="label-xs">Framgang</p>
            <p className="mt-1 font-display text-3xl tracking-[0.14em] text-white">
              NIVÅ {player.level}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm text-steel-300">
              {formatNumber(player.xpIntoLevel)} / {formatNumber(player.xpForLevel)} XP
            </p>
            <p className="text-xs text-steel-500">
              {formatNumber(player.xpForLevel - player.xpIntoLevel)} XP til neste nivå
            </p>
          </div>
        </div>
        <div className="mt-4">
          <Meter
            value={player.xpIntoLevel}
            max={player.xpForLevel}
            tone="red"
            hint={`${xpPct} %`}
          />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-white/[0.06] pt-4 sm:grid-cols-3">
          <div>
            <dt className="label-xs">Total erfaring</dt>
            <dd className="mt-0.5 font-mono text-sm text-white">
              {formatNumber(player.xp)} XP
            </dd>
          </div>
          <div>
            <dt className="label-xs">Rykte</dt>
            <dd className="mt-0.5 text-sm text-white">
              {reputationLabel(player.reputation)}
              <span className="ml-2 font-mono text-xs text-steel-500">
                {formatNumber(player.reputation)}
              </span>
            </dd>
          </div>
          <div>
            <dt className="label-xs">Distrikt</dt>
            <dd className="mt-0.5 text-sm text-white">
              <Link to="/byen" className="transition hover:text-blood-400">
                {district.name}
              </Link>
            </dd>
          </div>
        </dl>
      </section>

      {/* Status */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Helse"
          value={`${player.health} / ${LIMITS.maxHealth}`}
          sub={healthLabel(player.health)}
          accent="green"
          icon={<IconHeart />}
          delay={0}
        >
          <Meter value={player.health} max={LIMITS.maxHealth} tone="green" />
        </StatCard>

        <StatCard
          label="Energi"
          value={`${energy} / ${player.maxEnergy}`}
          sub={
            nextEnergy === null
              ? 'Full tank.'
              : `Neste poeng om ${formatDuration(nextEnergy)}`
          }
          accent="violet"
          icon={<IconBolt />}
          delay={60}
        >
          <Meter value={energy} max={player.maxEnergy} tone="violet" />
        </StatCard>

        <StatCard
          label="Respekt"
          value={formatNumber(player.reputation)}
          sub={reputationLabel(player.reputation)}
          accent="violet"
          icon={<IconStar />}
          delay={120}
        >
          <Meter
            value={Math.min(player.reputation, 3000)}
            max={3000}
            tone="violet"
            hint="Mot neste sjikt"
          />
        </StatCard>

        <StatCard
          label="Heat"
          value={`${player.heat} / ${LIMITS.maxHeat}`}
          sub={heatLabel(player.heat)}
          accent="red"
          icon={<IconFlame />}
          delay={180}
        >
          <Meter value={player.heat} max={LIMITS.maxHeat} tone="amber" />
        </StatCard>
      </section>

      {/* Økonomi og progresjon */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Kontanter"
          value={formatMoney(player.cash)}
          sub="Det du har på deg"
          accent="green"
          icon={<IconCash />}
          delay={0}
        />
        <StatCard
          label="Bank"
          value={formatMoney(player.bankBalance)}
          sub="Trygt, men ikke gratis å ta ut"
          accent="violet"
          icon={<IconBank />}
          delay={60}
        />
        <StatCard
          label="Ferdighetspoeng"
          value={formatNumber(player.skillPoints)}
          sub={
            player.skillPoints > 0 ? 'Ubrukte poeng venter' : 'Alt er brukt'
          }
          accent="red"
          icon={<IconTarget />}
          delay={120}
        />
      </section>

      {/* Formue */}
      <section className="panel animate-fade-up p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-lg tracking-[0.16em] text-white">FORMUE</h2>
          <p className="text-xs text-steel-500">Detaljene bor på sine egne sider.</p>
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            to="/okonomi/virksomheter"
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition
              hover:border-white/[0.14] hover:bg-white/[0.04]"
          >
            <dt className="label-xs flex items-center gap-2">
              <IconBuilding className="h-3.5 w-3.5" />
              Virksomheter
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-white">
              {holdings ? formatNumber(holdings.businesses) : '–'}
            </dd>
          </Link>

          <Link
            to="/eiendeler"
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition
              hover:border-white/[0.14] hover:bg-white/[0.04]"
          >
            <dt className="label-xs flex items-center gap-2">
              <IconShield className="h-3.5 w-3.5" />
              Eiendeler
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-white">
              {holdings ? formatNumber(holdings.assets) : '–'}
            </dd>
          </Link>

          <Link
            to="/eiendom"
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition
              hover:border-white/[0.14] hover:bg-white/[0.04]"
          >
            <dt className="label-xs flex items-center gap-2">
              <IconHome className="h-3.5 w-3.5" />
              Eiendom
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-white">
              {holdings ? formatNumber(holdings.properties) : '–'}
            </dd>
          </Link>

          <Link
            to="/okonomi/inventar"
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition
              hover:border-white/[0.14] hover:bg-white/[0.04]"
          >
            <dt className="label-xs flex items-center gap-2">
              <IconMap className="h-3.5 w-3.5" />
              Inventar
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-white">
              {holdings
                ? `${holdings.carried} / ${holdings.capacity}`
                : `– / ${INVENTORY_CAPACITY}`}
            </dd>
          </Link>
        </dl>
      </section>

      <PlayerSearch />
    </div>
  );
}
