import type { Request, Response } from 'express';
import type {
  BankActionResponse,
  MeResponse,
  TransactionListResponse,
} from '@skyggeby/shared';
import { toPlayerDto, toTransactionDto } from '../../lib/serialize';
import { amountSchema, parseOrThrow } from '../../lib/validation';
import { deposit, withdraw } from '../economy/bank.service';
import { listTransactions } from '../economy/transaction.service';
import { syncVitals } from './progression.service';

/**
 * Always re-reads from the database so the client can never cache a stale
 * state, and settles passive energy/heat on the way out.
 */
export async function getProfile(req: Request, res: Response) {
  const player = await syncVitals(req.player!.id);

  const body: MeResponse = { player: toPlayerDto(player) };
  res.status(200).json(body);
}

export async function getTransactions(req: Request, res: Response) {
  const limitRaw = Number(req.query.limit);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

  const result = await listTransactions(req.player!.id, {
    limit: Number.isFinite(limitRaw) ? limitRaw : 20,
    cursor,
  });

  const body: TransactionListResponse = {
    transactions: result.transactions.map(toTransactionDto),
    nextCursor: result.nextCursor,
  };
  res.status(200).json(body);
}

export async function postDeposit(req: Request, res: Response) {
  const { amount } = parseOrThrow(amountSchema, req.body);
  const result = await deposit(req.player!.id, amount);

  const body: BankActionResponse = {
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    message: result.message,
  };
  res.status(200).json(body);
}

export async function postWithdraw(req: Request, res: Response) {
  const { amount } = parseOrThrow(amountSchema, req.body);
  const result = await withdraw(req.player!.id, amount);

  const body: BankActionResponse = {
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    message: result.message,
  };
  res.status(200).json(body);
}
