import {
  LEDGER_LABELS,
  TRANSACTION_TYPE_LABELS,
  formatRelativeTime,
  formatSignedMoney,
} from '@skyggeby/shared';
import type { TransactionDto } from '@skyggeby/shared';

export function TransactionList({
  transactions,
  loading,
}: {
  transactions: TransactionDto[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <ul className="space-y-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="h-14 animate-pulse-soft rounded-lg bg-ink-850/70" />
        ))}
      </ul>
    );
  }

  if (transactions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-white/[0.08] px-4 py-8 text-center text-sm text-steel-500">
        Ingen bevegelser ennå. Alt du gjør med penger havner her.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.05]">
      {transactions.map((tx, index) => {
        const positive = tx.amount > 0;
        return (
          <li
            key={tx.id}
            className="flex animate-fade-up items-center justify-between gap-4 py-3"
            style={{ animationDelay: `${index * 35}ms` }}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {tx.description ?? TRANSACTION_TYPE_LABELS[tx.type]}
              </p>
              <p className="mt-0.5 text-xs text-steel-500">
                <span className="text-steel-400">{TRANSACTION_TYPE_LABELS[tx.type]}</span>
                <span className="mx-1.5 text-steel-500/60">·</span>
                {LEDGER_LABELS[tx.ledger]}
                <span className="mx-1.5 text-steel-500/60">·</span>
                {formatRelativeTime(tx.createdAt)}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p
                className={`font-mono text-sm font-semibold tabular-nums ${
                  positive ? 'text-neon' : 'text-blood-400'
                }`}
              >
                {formatSignedMoney(tx.amount)}
              </p>
              <p className="font-mono text-[0.68rem] text-steel-500">
                saldo {tx.balanceAfter.toLocaleString('nb-NO')}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
