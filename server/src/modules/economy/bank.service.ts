import { BANK_WITHDRAWAL_FEE, formatMoney } from '@skyggeby/shared';
import { badRequest } from '../../lib/errors';
import { applyLedgerEntries, type LedgerEntry, type LedgerResult } from './transaction.service';

/**
 * Moves cash into the bank. The amount is validated server side; the client's
 * number is only a request, never a fact.
 */
export async function deposit(
  playerId: string,
  amount: number,
): Promise<LedgerResult & { message: string }> {
  if (amount <= 0) throw badRequest('Beløpet må være større enn 0.');

  const entries: LedgerEntry[] = [
    {
      ledger: 'CASH',
      amount: -amount,
      type: 'BANK_INNSKUDD',
      source: 'bank.deposit',
      description: 'Satt inn på konto',
    },
    {
      ledger: 'BANK',
      amount,
      type: 'BANK_INNSKUDD',
      source: 'bank.deposit',
      description: 'Innskudd fra kontanter',
    },
  ];

  const result = await applyLedgerEntries(playerId, entries);
  return { ...result, message: `${formatMoney(amount)} satt inn på konto.` };
}

/**
 * Moves money out of the bank. A small fee is charged so that keeping money in
 * the bank has a real trade-off against carrying cash. The fee is booked as its
 * own ledger row so the player can always see what was taken and why.
 */
export async function withdraw(
  playerId: string,
  amount: number,
): Promise<LedgerResult & { message: string }> {
  if (amount <= 0) throw badRequest('Beløpet må være større enn 0.');

  // Rounded up, with a floor of 1 kr: a floored fee would be zero for anything
  // under 50 kr, letting a player dodge the fee entirely by splitting a large
  // withdrawal into many small ones.
  const fee = Math.max(1, Math.ceil(amount * BANK_WITHDRAWAL_FEE));
  const payout = amount - fee;

  if (payout <= 0) {
    throw badRequest('Beløpet er for lite til å dekke gebyret.');
  }

  const entries: LedgerEntry[] = [
    {
      ledger: 'BANK',
      amount: -amount,
      type: 'BANK_UTTAK',
      source: 'bank.withdraw',
      description: 'Tatt ut fra konto',
    },
    {
      ledger: 'CASH',
      amount,
      type: 'BANK_UTTAK',
      source: 'bank.withdraw',
      description: 'Uttak til kontanter',
    },
  ];

  if (fee > 0) {
    entries.push({
      ledger: 'CASH',
      amount: -fee,
      type: 'BANK_GEBYR',
      source: 'bank.withdraw.fee',
      description: `Uttaksgebyr ${(BANK_WITHDRAWAL_FEE * 100).toFixed(0)} %`,
    });
  }

  const result = await applyLedgerEntries(playerId, entries);

  const message =
    fee > 0
      ? `${formatMoney(payout)} tatt ut. Gebyr: ${formatMoney(fee)}.`
      : `${formatMoney(payout)} tatt ut.`;

  return { ...result, message };
}
