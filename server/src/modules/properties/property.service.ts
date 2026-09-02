import type { Player, Prisma, Property, Transaction } from '@prisma/client';
import {
  PROPERTY_TUNING,
  calculatePropertySaleValue,
  calculatePropertyValue,
  findPropertyType,
  formatMoney,
  resolveDistrict,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, notFound } from '../../lib/errors';
import { applyLedgerEntriesTx, lockPlayer } from '../economy/transaction.service';

export interface PropertyBuyResult {
  property: Property;
  properties: Property[];
  player: Player;
  transactions: Transaction[];
  message: string;
}

export interface PropertySellResult {
  properties: Property[];
  player: Player;
  transactions: Transaction[];
  saleValue: number;
  message: string;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** Everything the player owns, oldest first. */
export async function listProperties(playerId: string): Promise<Property[]> {
  return prisma.property.findMany({
    where: { playerId },
    orderBy: [{ purchasedAt: 'asc' }],
    take: 100,
  });
}

async function propertiesTx(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<Property[]> {
  return tx.property.findMany({ where: { playerId }, orderBy: [{ purchasedAt: 'asc' }] });
}

/**
 * One property, scoped to its owner.
 *
 * A property somebody else owns answers exactly the way one that does not exist
 * does, so an id alone reveals nothing about anyone else's holdings. There is
 * no public property endpoint in v1, and this is the only way in.
 */
export async function getProperty(
  playerId: string,
  propertyId: string,
): Promise<Property> {
  const row = await prisma.property.findFirst({ where: { id: propertyId, playerId } });

  if (!row) throw notFound('Fant ikke denne eiendommen.');
  return row;
}

export async function countProperties(playerId: string): Promise<number> {
  return prisma.property.count({ where: { playerId } });
}

/**
 * Serialises concurrent writes to one player's properties.
 *
 * Always taken *after* `lockPlayer`, never before: a single lock order across
 * both paths - buy and sell - is what keeps two requests from deadlocking
 * against each other.
 */
async function lockProperties(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM properties WHERE "playerId" = ${playerId} ORDER BY id FOR UPDATE`;
}

/* ------------------------------------------------------------------ *
 * Buying
 * ------------------------------------------------------------------ */

/**
 * Buys one property from the catalogue.
 *
 * The client names a type and picks a name. Price, district, condition,
 * capacity and security are read from the server's catalogue, and the money
 * moves through the existing ledger so the purchase is atomic with its
 * bookkeeping.
 *
 * The player row lock is what enforces the ceiling: every purchase for one
 * player is serialised, so the count read inside the transaction is the truth
 * rather than a guess a parallel request could invalidate.
 */
export async function buyProperty(
  playerId: string,
  propertyTypeId: string,
  name: string,
): Promise<PropertyBuyResult> {
  const definition = findPropertyType(propertyTypeId);
  if (!definition) {
    throw notFound('Denne eiendommen finnes ikke.');
  }

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);

    const player = await tx.player.findUnique({ where: { id: playerId } });
    if (!player) throw notFound('Fant ikke spilleren.');

    const owned = await tx.property.count({ where: { playerId } });
    if (owned >= PROPERTY_TUNING.maxProperties) {
      throw new AppError(
        400,
        'MAKS_EIENDOMMER',
        `Du kan maksimalt eie ${PROPERTY_TUNING.maxProperties} eiendommer.`,
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

    // The address comes from the catalogue, never from the request and never
    // from where the player happens to be standing.
    const district = resolveDistrict(definition.districtId);

    const ledger = await applyLedgerEntriesTx(
      tx,
      playerId,
      [
        {
          ledger: 'CASH',
          amount: -definition.purchasePrice,
          type: 'EIENDOM_KJOP',
          source: `property.buy.${definition.id}`,
          description: `Kjøpte ${definition.name.toLowerCase()} i ${district.name}`,
        },
      ],
      { skipLock: true },
    );

    const property = await tx.property.create({
      data: {
        playerId,
        propertyTypeId: definition.id,
        name,
        // Copied onto the row: every later valuation reads this, not the
        // catalogue, so a rebalancing cannot rewrite history.
        purchasePrice: definition.purchasePrice,
        currentValue: calculatePropertyValue(
          definition.purchasePrice,
          PROPERTY_TUNING.startCondition,
        ),
        condition: PROPERTY_TUNING.startCondition,
        storageCapacity: definition.storageCapacity,
        security: definition.security,
        districtId: district.id,
      },
    });

    return {
      property,
      properties: await propertiesTx(tx, playerId),
      player: ledger.player,
      transactions: ledger.transactions,
      message: `Du kjøpte ${definition.name.toLowerCase()} for ${formatMoney(
        definition.purchasePrice,
      )}. ${name} ligger i ${district.name}.`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Selling
 * ------------------------------------------------------------------ */

/**
 * Sells one property.
 *
 * The delete is the claim: it is scoped to the owner, so two requests racing
 * for the same property cannot both succeed and only the caller whose delete
 * actually removed a row gets paid. The credit happens in the same transaction,
 * so if the ledger refuses - at the wealth ceiling, say - the property is still
 * there afterwards.
 *
 * The sale value is computed from the price stored on the row, never from the
 * catalogue and never from anything the client sent.
 */
export async function sellProperty(
  playerId: string,
  propertyId: string,
): Promise<PropertySellResult> {
  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await lockProperties(tx, playerId);

    const property = await tx.property.findFirst({
      where: { id: propertyId, playerId },
    });

    if (!property) {
      // Same answer whether it never existed or belongs to somebody else.
      throw notFound('Fant ikke denne eiendommen.');
    }

    const saleValue = calculatePropertySaleValue(
      property.purchasePrice,
      property.condition,
    );

    const removed = await tx.property.deleteMany({ where: { id: propertyId, playerId } });

    if (removed.count !== 1) {
      throw new AppError(409, 'ALLEREDE_SOLGT', 'Denne eiendommen er allerede solgt.');
    }

    const ledger = await applyLedgerEntriesTx(
      tx,
      playerId,
      [
        {
          ledger: 'CASH',
          amount: saleValue,
          type: 'EIENDOM_SALG',
          source: `property.sell.${property.propertyTypeId}`,
          description: `Solgte ${property.name}`,
        },
      ],
      { skipLock: true },
    );

    return {
      properties: await propertiesTx(tx, playerId),
      player: ledger.player,
      transactions: ledger.transactions,
      saleValue,
      message: `Du solgte ${property.name} for ${formatMoney(saleValue)}.`,
    };
  });
}
