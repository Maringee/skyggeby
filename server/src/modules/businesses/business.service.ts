import type { Business, Player, Prisma, Transaction } from '@prisma/client';
import {
  BUSINESS_TUNING,
  calculateBusinessSettlement,
  findBusinessType,
  formatMoney,
  resolveDistrict,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, notFound } from '../../lib/errors';
import { applyLedgerEntriesTx, lockPlayer } from '../economy/transaction.service';

export interface BusinessListResult {
  businesses: Business[];
  /** Kroner credited to the accounts by this settlement pass. */
  earned: number;
}

export interface BusinessDetailResult {
  business: Business;
  earned: number;
}

export interface BuyBusinessResult {
  business: Business;
  businesses: Business[];
  player: Player;
  transactions: Transaction[];
  message: string;
}

export interface WithdrawResult {
  business: Business;
  businesses: Business[];
  player: Player;
  transactions: Transaction[];
  amount: number;
  message: string;
}

/* ------------------------------------------------------------------ *
 * Locking
 * ------------------------------------------------------------------ */

/**
 * Serialises concurrent writes to one player's businesses.
 *
 * Always taken *after* `lockPlayer`, never before: a single lock order across
 * every path - purchase, settlement, withdrawal - is what keeps two requests
 * from deadlocking against each other.
 */
async function lockBusinesses(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM businesses WHERE "playerId" = ${playerId} ORDER BY id FOR UPDATE`;
}

async function lockBusiness(
  tx: Prisma.TransactionClient,
  playerId: string,
  businessId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} AND "playerId" = ${playerId} FOR UPDATE`;
}

async function businessesTx(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<Business[]> {
  return tx.business.findMany({ where: { playerId }, orderBy: [{ purchasedAt: 'asc' }] });
}

/* ------------------------------------------------------------------ *
 * Settlement
 * ------------------------------------------------------------------ */

/**
 * Credits one business with what it has earned since it was last settled.
 *
 * The row must already be locked by the caller. That lock is the whole defence
 * against double settlement: two requests arriving at once are serialised, and
 * the second one reads the timestamp the first one wrote, so it finds nothing
 * left to pay.
 *
 * Nothing is written when there is nothing to credit - a settlement is not an
 * event in itself, and it never produces a `Transaction` row. Money only
 * becomes the player's when they withdraw it.
 */
async function settleBusinessTx(
  tx: Prisma.TransactionClient,
  business: Business,
  now: Date,
): Promise<{ business: Business; net: number }> {
  const definition = findBusinessType(business.businessTypeId);

  // An owned business whose type has left the catalogue simply stops earning
  // rather than crashing the player's page.
  if (!definition) return { business, net: 0 };

  const settlement = calculateBusinessSettlement(
    {
      lastSettlementAt: business.lastSettlementAt,
      incomePerDay: definition.incomePerDay,
      operatingCostPerDay: definition.operatingCostPerDay,
    },
    now,
  );

  if (
    settlement.net <= 0 &&
    settlement.nextSettlementAt.getTime() === business.lastSettlementAt.getTime()
  ) {
    return { business, net: 0 };
  }

  const updated = await tx.business.update({
    where: { id: business.id },
    data: {
      cashBalance: { increment: settlement.net },
      lastSettlementAt: settlement.nextSettlementAt,
    },
  });

  return { business: updated, net: settlement.net };
}

/** Settles every business a player owns, inside an open transaction. */
async function settleAllTx(
  tx: Prisma.TransactionClient,
  playerId: string,
  now: Date,
): Promise<BusinessListResult> {
  const rows = await businessesTx(tx, playerId);

  const businesses: Business[] = [];
  let earned = 0;

  for (const row of rows) {
    const result = await settleBusinessTx(tx, row, now);
    businesses.push(result.business);
    earned += result.net;
  }

  return { businesses, earned };
}

/**
 * Everything the player owns, with earnings brought up to date first.
 *
 * Reading the list settles it, which is why a GET writes: there is no cron job
 * and no daily rows, so the numbers are only ever correct because someone
 * looked at them.
 */
export async function listBusinesses(playerId: string): Promise<BusinessListResult> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await lockBusinesses(tx, playerId);
    return settleAllTx(tx, playerId, now);
  });
}

/**
 * One business, scoped to its owner.
 *
 * A business the player does not own answers exactly the way one that does not
 * exist does, so an id alone reveals nothing about anyone else's holdings.
 */
export async function getBusiness(
  playerId: string,
  businessId: string,
): Promise<BusinessDetailResult> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await lockBusiness(tx, playerId, businessId);

    const row = await tx.business.findFirst({ where: { id: businessId, playerId } });
    if (!row) throw notFound('Fant ikke denne virksomheten.');

    const settled = await settleBusinessTx(tx, row, now);
    return { business: settled.business, earned: settled.net };
  });
}

/* ------------------------------------------------------------------ *
 * Purchase
 * ------------------------------------------------------------------ */

/**
 * Buys one business from the catalogue.
 *
 * The client names a type and picks a name. Price, district, rates, condition,
 * activity and risk are all read from the server's catalogue, and the money
 * moves through the existing ledger so the purchase is atomic with its
 * bookkeeping.
 *
 * The player row lock is what enforces the limit: every purchase for one player
 * is serialised, so the count read inside the transaction is the truth rather
 * than a guess that a parallel request could invalidate.
 */
export async function buyBusiness(
  playerId: string,
  businessTypeId: string,
  name: string,
): Promise<BuyBusinessResult> {
  const definition = findBusinessType(businessTypeId);
  if (!definition) {
    throw notFound('Denne virksomheten finnes ikke.');
  }

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);

    const player = await tx.player.findUnique({ where: { id: playerId } });
    if (!player) throw notFound('Fant ikke spilleren.');

    const owned = await tx.business.count({ where: { playerId } });
    if (owned >= BUSINESS_TUNING.maxBusinesses) {
      throw new AppError(
        400,
        'MAKS_VIRKSOMHETER',
        `Du kan maksimalt eie ${BUSINESS_TUNING.maxBusinesses} virksomheter.`,
      );
    }

    if (player.cash < definition.purchasePrice) {
      throw new AppError(
        400,
        'IKKE_NOK_MIDLER',
        `Du har ikke råd til ${definition.name.toLowerCase()}. Den koster ${formatMoney(
          definition.purchasePrice,
        )}, du har ${formatMoney(player.cash)}.`,
      );
    }

    // The district comes from the catalogue, never from the request and never
    // from where the player happens to be standing.
    const district = resolveDistrict(definition.districtId);

    const ledger = await applyLedgerEntriesTx(
      tx,
      playerId,
      [
        {
          ledger: 'CASH',
          amount: -definition.purchasePrice,
          type: 'VIRKSOMHET_KJOP',
          source: `business.buy.${definition.id}`,
          description: `Kjøpte ${definition.name.toLowerCase()} i ${district.name}`,
        },
      ],
      { skipLock: true },
    );

    const purchasedAt = new Date();

    const business = await tx.business.create({
      data: {
        playerId,
        businessTypeId: definition.id,
        name,
        districtId: district.id,
        // Nothing is earned before the business is owned: the clock starts at
        // the purchase, so there is never retroactive income.
        cashBalance: 0,
        condition: definition.condition,
        activity: definition.activity,
        risk: definition.risk,
        purchasedAt,
        lastSettlementAt: purchasedAt,
      },
    });

    return {
      business,
      businesses: await businessesTx(tx, playerId),
      player: ledger.player,
      transactions: ledger.transactions,
      message: `Du kjøpte ${definition.name.toLowerCase()} for ${formatMoney(
        definition.purchasePrice,
      )}. Den heter nå ${name}.`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Withdrawal
 * ------------------------------------------------------------------ */

/**
 * Moves everything on a business account into the player's pocket.
 *
 * Settlement runs first, so the player always collects what the business has
 * actually earned up to this second. The zeroing update is the claim: it is
 * scoped to the balance that was read, so of two requests racing for the same
 * account only the one whose write moved the row gets paid. The ledger call
 * then credits the player inside the same transaction - either both happen or
 * neither does.
 */
export async function withdrawFromBusiness(
  playerId: string,
  businessId: string,
): Promise<WithdrawResult> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await lockBusiness(tx, playerId, businessId);

    const row = await tx.business.findFirst({ where: { id: businessId, playerId } });
    if (!row) {
      // Same answer whether it never existed or belongs to somebody else.
      throw notFound('Fant ikke denne virksomheten.');
    }

    const settled = await settleBusinessTx(tx, row, now);
    const amount = settled.business.cashBalance;

    if (amount <= 0) {
      throw new AppError(
        400,
        'INGEN_MIDLER',
        'Det står ingenting på driftskontoen ennå.',
      );
    }

    const claimed = await tx.business.updateMany({
      where: { id: businessId, playerId, cashBalance: amount },
      data: { cashBalance: 0 },
    });

    if (claimed.count !== 1) {
      throw new AppError(409, 'ALLEREDE_HENTET', 'Pengene er allerede hentet ut.');
    }

    const ledger = await applyLedgerEntriesTx(
      tx,
      playerId,
      [
        {
          ledger: 'CASH',
          amount,
          type: 'VIRKSOMHET_UTTAK',
          source: `business.withdraw.${row.businessTypeId}`,
          description: `Uttak fra ${row.name}`,
        },
      ],
      { skipLock: true },
    );

    const business = await tx.business.findFirstOrThrow({
      where: { id: businessId, playerId },
    });

    return {
      business,
      businesses: await businessesTx(tx, playerId),
      player: ledger.player,
      transactions: ledger.transactions,
      amount,
      message: `Du hentet ut ${formatMoney(amount)} fra ${row.name}.`,
    };
  });
}

/** How many businesses the player owns right now. Used by the catalogue view. */
export async function countBusinesses(playerId: string): Promise<number> {
  return prisma.business.count({ where: { playerId } });
}
