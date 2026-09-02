import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@skyggeby/shared';
import type { TransactionDto } from '@skyggeby/shared';
import { api } from '@/api/endpoints';
import { SectionTabs } from '@/components/GataTabs';
import { PageHeader } from '@/components/PageHeader';
import { TransactionList } from '@/components/TransactionList';
import { useAuth } from '@/state/AuthContext';

const PAGE_SIZE = 100;

/** The full ledger. The compact version stays on the bank page. */
export function TransactionsPage() {
  const { player } = useAuth();
  const [transactions, setTransactions] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.transactions(PAGE_SIZE);
      setTransactions(res.transactions);
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!player) return null;

  const incoming = transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const outgoing = transactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Økonomi"
        title="Transaksjoner"
        intro="Hele regnskapet. Hver eneste krone som har beveget seg, ført av serveren."
        aside={
          <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
            <span className="label-xs mr-2">Linjer</span>
            <span className="font-mono font-semibold text-white">{transactions.length}</span>
          </span>
        }
      />

      <SectionTabs section="/okonomi" />

      {transactions.length > 0 && (
        <section className="grid animate-fade-in gap-4 sm:grid-cols-2">
          <div className="panel p-4">
            <p className="label-xs">Inn</p>
            <p className="mt-1 font-mono text-lg font-semibold text-neon">
              {formatMoney(incoming)}
            </p>
          </div>
          <div className="panel p-4">
            <p className="label-xs">Ut</p>
            <p className="mt-1 font-mono text-lg font-semibold text-blood-400">
              {formatMoney(Math.abs(outgoing))}
            </p>
          </div>
        </section>
      )}

      <section className="panel panel-edge animate-fade-up p-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg tracking-[0.16em] text-white">REGNSKAP</h2>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="text-xs font-semibold uppercase tracking-[0.14em] text-steel-400 transition hover:text-blood-400"
          >
            Oppdater
          </button>
        </div>

        <div className="mt-4">
          <TransactionList transactions={transactions} loading={loading} />
        </div>
      </section>
    </div>
  );
}
