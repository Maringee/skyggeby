import { useState, type FormEvent } from 'react';
import { BANK_WITHDRAWAL_FEE, formatMoney } from '@skyggeby/shared';
import type { BankActionResponse } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from './Alert';

interface BankPanelProps {
  cash: number;
  bankBalance: number;
  onResult: (result: BankActionResponse) => void;
}

type Mode = 'innskudd' | 'uttak';

export function BankPanel({ cash, bankBalance, onResult }: BankPanelProps) {
  const [mode, setMode] = useState<Mode>('innskudd');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const available = mode === 'innskudd' ? cash : bankBalance;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const parsed = Number(amount.replace(/\s/g, ''));
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      setError('Skriv inn et helt beløp større enn 0.');
      return;
    }

    setBusy(true);
    try {
      // The server validates and applies this; the response is the new truth.
      const result =
        mode === 'innskudd' ? await api.deposit(parsed) : await api.withdraw(parsed);
      onResult(result);
      setSuccess(result.message);
      setAmount('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Handlingen feilet. Prøv igjen.');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setSuccess(null);
  };

  return (
    <section className="panel panel-edge animate-fade-up p-6" style={{ animationDelay: '160ms' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl tracking-[0.16em] text-white">BANKEN</h2>
          <p className="mt-1 text-xs text-steel-500">
            Kontanter kan mistes. Penger på konto er tryggere, men uttak koster{' '}
            {(BANK_WITHDRAWAL_FEE * 100).toFixed(0)} % i gebyr.
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-white/[0.06] bg-ink-850/60 p-1">
        {(['innskudd', 'uttak'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => switchMode(option)}
            className={`rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              mode === option
                ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow'
                : 'text-steel-400 hover:text-white'
            }`}
          >
            {option === 'innskudd' ? 'Sett inn' : 'Ta ut'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
        <div>
          <label htmlFor="amount" className="label-xs mb-2 block">
            Beløp
          </label>
          <div className="flex gap-2">
            <input
              id="amount"
              inputMode="numeric"
              className="field font-mono"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            />
            <button
              type="button"
              onClick={() => setAmount(String(available))}
              className="btn-ghost px-4 py-3 text-xs"
              disabled={available <= 0}
            >
              Alt
            </button>
          </div>
          <p className="mt-1.5 text-xs text-steel-500">
            Tilgjengelig: <span className="font-mono text-steel-300">{formatMoney(available)}</span>
          </p>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {success && <Alert tone="success">{success}</Alert>}

        <button type="submit" className="btn-secondary w-full" disabled={busy}>
          {busy ? 'Behandler ...' : mode === 'innskudd' ? 'Sett inn på konto' : 'Ta ut kontanter'}
        </button>
      </form>
    </section>
  );
}
