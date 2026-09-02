import { useCallback, useEffect, useState } from 'react';
import { BANK_WITHDRAWAL_FEE, formatMoney } from '@skyggeby/shared';
import type { BankActionResponse, TransactionDto } from '@skyggeby/shared';
import { api } from '@/api/endpoints';
import { BankPanel } from '@/components/BankPanel';
import { SectionTabs } from '@/components/GataTabs';
import { IconBank, IconCash, IconShield } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { TransactionList } from '@/components/TransactionList';
import { useAuth } from '@/state/AuthContext';

const TX_LIMIT = 20;

export function EconomyPage() {
  const { player, setPlayer, refresh } = useAuth();
  const [transactions, setTransactions] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.transactions(TX_LIMIT);
      setTransactions(res.transactions);
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void refresh().catch(() => undefined);
  }, [load, refresh]);

  if (!player) return null;

  const handleBankResult = (result: BankActionResponse) => {
    setPlayer(result.player);
    setTransactions((prev) =>
      [...result.transactions].reverse().concat(prev).slice(0, TX_LIMIT),
    );
  };

  const totalWorth = player.cash + player.bankBalance;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Økonomi"
        title="Kassa"
        intro="Alt som beveger seg av penger får sin egen linje. Serveren fører regnskapet, ikke nettleseren."
        aside={
          <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
            <span className="label-xs mr-2">Samlet</span>
            <span className="font-mono font-semibold text-white">
              {formatMoney(totalWorth)}
            </span>
          </span>
        }
      />

      <SectionTabs section="/okonomi" />

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Kontanter"
          value={formatMoney(player.cash)}
          sub="I lomma. Lett tilgjengelig, lett å miste."
          accent="green"
          icon={<IconCash />}
          delay={0}
        />
        <StatCard
          label="Bank"
          value={formatMoney(player.bankBalance)}
          sub={`Trygt lagret. Uttak koster ${(BANK_WITHDRAWAL_FEE * 100).toFixed(0)} %.`}
          accent="violet"
          icon={<IconBank />}
          delay={60}
        />
        <StatCard
          label="Samlet formue"
          value={formatMoney(totalWorth)}
          sub="Kontanter og konto til sammen."
          accent="steel"
          icon={<IconShield />}
          delay={120}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <BankPanel
          cash={player.cash}
          bankBalance={player.bankBalance}
          onResult={handleBankResult}
        />

        <section
          className="panel panel-edge animate-fade-up p-6"
          style={{ animationDelay: '220ms' }}
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-xl tracking-[0.16em] text-white">REGNSKAP</h2>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load();
                void refresh().catch(() => undefined);
              }}
              className="text-xs font-semibold uppercase tracking-[0.14em] text-steel-400 transition hover:text-blood-400"
            >
              Oppdater
            </button>
          </div>
          <p className="mt-1 text-xs text-steel-500">
            Alle pengeendringer bokføres av serveren og kan ikke redigeres.
          </p>

          <div className="mt-4">
            <TransactionList transactions={transactions} loading={loading} />
          </div>
        </section>
      </section>
    </div>
  );
}
