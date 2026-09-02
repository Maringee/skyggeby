import type { Prisma, Player, Transaction } from '@prisma/client';
import { LIMITS, type Ledger, type TransactionType } from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, badRequest, notFound } from '../../lib/errors';

export interface LedgerEntry {
  /** Which balance to move. */
  ledger: Ledger;
  /** Signed amount in whole kroner. Positive = in, negative = out. */
  amount: number;
  type: TransactionType;
  /** Machine readable origin, e.g. "bank.deposit". */
  source: string;
  /** Norwegian text shown in the player's ledger. */
  description?: string;
}

export interface LedgerResult {
  player: Player;
  transactions: Transaction[];
}

const LEDGER_FIELD: Record<Ledger, 'cash' | 'bankBalance'> = {
  CASH: 'cash',
  BANK: 'bankBalance',
};

const LEDGER_ERROR: Record<Ledger, string> = {
  CASH: 'Du har ikke nok kontanter.',
  BANK: 'Du har ikke nok penger på konto.',
};

/**
 * The single, authoritative entry point for changing a player's money.
 *
 * Guarantees:
 *  - runs inside one database transaction with a row lock on the player,
 *  - never lets a balance go negative or overflow the economy ceiling,
 *  - writes one immutable `Transaction` row per money movement.
 *
 * Nothing else in the codebase is allowed to update `cash` or `bankBalance`.
 */
export async function applyLedgerEntries(
  playerId: string,
  entries: LedgerEntry[],
): Promise<LedgerResult> {
  return prisma.$transaction((tx) => applyLedgerEntriesTx(tx, playerId, entries));
}

/**
 * Same rules as {@link applyLedgerEntries}, but joins a transaction that the
 * caller already opened. Use this when money changes must be atomic together
 * with other player state, such as a crime payout landing alongside XP.
 *
 * Pass `skipLock` only when the caller already holds the row lock.
 */
export async function applyLedgerEntriesTx(
  tx: Prisma.TransactionClient,
  playerId: string,
  entries: LedgerEntry[],
  options: { skipLock?: boolean } = {},
): Promise<LedgerResult> {
  if (entries.length === 0) {
    throw badRequest('Ingen bevegelser å bokføre.');
  }

  for (const entry of entries) {
    if (!Number.isInteger(entry.amount)) {
      throw badRequest('Beløpet må være et helt tall.');
    }
    if (entry.amount === 0) {
      throw badRequest('Beløpet må være større enn 0.');
    }
  }

  if (!options.skipLock) {
    await lockPlayer(tx, playerId);
  }

  const player = await tx.player.findUnique({ where: { id: playerId } });
  if (!player) throw notFound('Fant ikke spilleren.');

  const balances: Record<'cash' | 'bankBalance', number> = {
    cash: player.cash,
    bankBalance: player.bankBalance,
  };

  const created: Transaction[] = [];

  for (const entry of entries) {
    const field = LEDGER_FIELD[entry.ledger];
    const next = balances[field] + entry.amount;

    if (next < 0) {
      throw new AppError(400, 'IKKE_NOK_MIDLER', LEDGER_ERROR[entry.ledger]);
    }
    if (next > LIMITS.maxMoney) {
      throw new AppError(
        400,
        'TAK_NADD',
        'Du har nådd taket for hvor mye formue en spiller kan ha.',
      );
    }

    balances[field] = next;

    const row = await tx.transaction.create({
      data: {
        playerId,
        amount: entry.amount,
        type: entry.type,
        ledger: entry.ledger,
        source: entry.source,
        description: entry.description ?? null,
        balanceAfter: next,
      },
    });

    created.push(row);
  }

  const updated = await tx.player.update({
    where: { id: playerId },
    data: { cash: balances.cash, bankBalance: balances.bankBalance },
  });

  return { player: updated, transactions: created };
}

/** Serialises concurrent writes for one player inside an open transaction. */
export async function lockPlayer(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM players WHERE id = ${playerId} FOR UPDATE`;
}

/**
 * Variant used during account creation, where the player row is written in the
 * same transaction and therefore cannot be locked separately.
 */
export async function recordInitialGrant(
  tx: Prisma.TransactionClient,
  player: Player,
): Promise<void> {
  const entries: Array<{ ledger: Ledger; amount: number; balanceAfter: number }> = [];

  if (player.cash > 0) {
    entries.push({ ledger: 'CASH', amount: player.cash, balanceAfter: player.cash });
  }
  if (player.bankBalance > 0) {
    entries.push({
      ledger: 'BANK',
      amount: player.bankBalance,
      balanceAfter: player.bankBalance,
    });
  }

  for (const entry of entries) {
    await tx.transaction.create({
      data: {
        playerId: player.id,
        amount: entry.amount,
        type: 'STARTKAPITAL',
        ledger: entry.ledger,
        source: 'account.created',
        description: 'Startkapital ved registrering',
        balanceAfter: entry.balanceAfter,
      },
    });
  }
}

export interface TransactionQuery {
  limit?: number;
  cursor?: string | undefined;
}

export async function listTransactions(playerId: string, query: TransactionQuery = {}) {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);

  const rows = await prisma.transaction.findMany({
    where: { playerId },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    transactions: page,
    nextCursor: hasMore && last ? last.id : null,
  };
}
