import type { Asset, Player, Prisma, Transaction, Vehicle } from '@prisma/client';
import {
  ASSET_STATUS_BLOCK_REASONS,
  ASSET_TUNING,
  VEHICLE_TUNING,
  calculateSaleValue,
  canSellStatus,
  findAssetType,
  formatMoney,
  isVehicleTypeId,
  resolveDistrict,
  type AssetCategory,
  type AssetStatus,
  type AssetTypeDefinition,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, notFound } from '../../lib/errors';
import { applyLedgerEntriesTx, lockPlayer } from '../economy/transaction.service';

export interface BuyResult {
  asset: Asset;
  /** Set when the asset was a vehicle, which is registered alongside it. */
  vehicle: Vehicle | null;
  player: Player;
  transactions: Transaction[];
  message: string;
}

export interface SellResult {
  player: Player;
  transactions: Transaction[];
  saleValue: number;
  message: string;
}

/** Everything the player owns, newest first. */
export async function listAssets(playerId: string): Promise<Asset[]> {
  return prisma.asset.findMany({
    where: { playerId },
    orderBy: [{ purchasedAt: 'desc' }],
    take: 500,
  });
}

/** Same, inside an open transaction. */
async function listAssetsTx(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<Asset[]> {
  return tx.asset.findMany({ where: { playerId }, orderBy: [{ purchasedAt: 'desc' }] });
}

export interface BuyOptions {
  /**
   * Name for the vehicle this purchase registers. Ignored for anything that is
   * not a vehicle; defaults to the catalogue name.
   */
  vehicleName?: string;
}

/**
 * Buys one asset from the catalogue, inside a transaction the caller opened and
 * already holds the player's row lock for.
 *
 * This is the single implementation of "an asset is bought": the vehicle module
 * joins it rather than reimplementing it, so there is exactly one place where
 * money leaves a player in exchange for a thing.
 */
export async function buyAssetTx(
  tx: Prisma.TransactionClient,
  playerId: string,
  definition: AssetTypeDefinition,
  options: BuyOptions = {},
): Promise<BuyResult> {
  const player = await tx.player.findUnique({ where: { id: playerId } });
  if (!player) throw notFound('Fant ikke spilleren.');

  const isVehicle = isVehicleTypeId(definition.id);

  // The ceiling on vehicles belongs here rather than in one endpoint, or it
  // would be bypassable simply by buying the car from the asset catalogue.
  if (isVehicle) {
    const owned = await tx.vehicle.count({ where: { playerId } });
    if (owned >= VEHICLE_TUNING.maxVehicles) {
      throw new AppError(
        400,
        'MAKS_KJORETOY',
        `Du har allerede ${VEHICLE_TUNING.maxVehicles} kjøretøy.`,
      );
    }
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

  // The district comes from the locked row, never from the request.
  const district = resolveDistrict(player.currentDistrictId);

  // Money moves the same way it does everywhere else in the game.
  const ledger = await applyLedgerEntriesTx(
    tx,
    playerId,
    [
      {
        ledger: 'CASH',
        amount: -definition.purchasePrice,
        type: 'EIENDEL_KJOP',
        source: `asset.buy.${definition.id}`,
        description: `Kjøpte ${definition.name.toLowerCase()} i ${district.name}`,
      },
    ],
    { skipLock: true },
  );

  const asset = await tx.asset.create({
    data: {
      playerId,
      assetTypeId: definition.id,
      name: definition.name,
      category: definition.category as AssetCategory,
      purchasePrice: definition.purchasePrice,
      // Worth starts at what was paid; the two diverge from here on.
      currentValue: definition.purchasePrice,
      condition: ASSET_TUNING.startCondition,
      maintenanceCostPerDay: definition.maintenanceCostPerDay,
      visibility: definition.visibility,
      risk: definition.risk,
      location: district.id,
      status: 'ACTIVE',
      // Buying something never puts it in your hands; the player must choose.
      storageLocation: 'STORED',
    },
  });

  // A vehicle asset is always accompanied by its vehicle row, whichever
  // endpoint bought it, so the two systems can never disagree about what the
  // player owns. It starts parked, where the player was standing.
  const vehicle = isVehicle
    ? await tx.vehicle.create({
        data: {
          playerId,
          assetId: asset.id,
          vehicleTypeId: definition.id,
          name: options.vehicleName ?? definition.name,
          locationDistrictId: district.id,
          isActive: false,
        },
      })
    : null;

  return {
    asset,
    vehicle,
    player: ledger.player,
    transactions: ledger.transactions,
    message: `Du kjøpte ${definition.name.toLowerCase()} for ${formatMoney(
      definition.purchasePrice,
    )}.`,
  };
}

/**
 * Buys one asset from the catalogue.
 *
 * The client names a type and nothing else. Price, district, condition and
 * every other number are read from the server's catalogue or the player's own
 * locked row, and the money moves through the existing ledger so the purchase
 * is atomic with its bookkeeping.
 */
export async function buyAsset(playerId: string, assetTypeId: string): Promise<BuyResult> {
  const definition = findAssetType(assetTypeId);
  if (!definition) {
    throw notFound('Denne eiendelen finnes ikke.');
  }

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    return buyAssetTx(tx, playerId, definition);
  });
}

/**
 * Sells one asset, inside a transaction the caller opened and already holds the
 * player's row lock for.
 *
 * The delete is the claim: it is scoped to the owner and to a sellable status,
 * so two requests racing for the same asset cannot both succeed, and one player
 * can never touch another's row. Only the caller whose delete actually removed
 * a row gets paid. A vehicle row hanging off the asset goes with it, by
 * cascade - there is no second bookkeeping to keep in step.
 */
export async function sellAssetTx(
  tx: Prisma.TransactionClient,
  playerId: string,
  assetId: string,
): Promise<SellResult> {
  const asset = await tx.asset.findFirst({ where: { id: assetId, playerId } });
  if (!asset) {
    // Deliberately the same answer whether it never existed or belongs to
    // someone else - an id alone reveals nothing.
    throw notFound('Fant ikke denne eiendelen.');
  }

  const status = asset.status as AssetStatus;
  if (!canSellStatus(status)) {
    throw new AppError(
      400,
      'KAN_IKKE_SELGES',
      ASSET_STATUS_BLOCK_REASONS[status] ?? 'Denne eiendelen kan ikke selges.',
    );
  }

  const saleValue = calculateSaleValue(asset.purchasePrice, asset.condition);

  const removed = await tx.asset.deleteMany({
    where: { id: assetId, playerId, status: { in: ['ACTIVE', 'STORED'] } },
  });

  if (removed.count !== 1) {
    throw new AppError(409, 'ALLEREDE_SOLGT', 'Denne eiendelen er allerede solgt.');
  }

  const ledger = await applyLedgerEntriesTx(
    tx,
    playerId,
    [
      {
        ledger: 'CASH',
        amount: saleValue,
        type: 'EIENDEL_SALG',
        source: `asset.sell.${asset.assetTypeId}`,
        description: `Solgte ${asset.name.toLowerCase()}`,
      },
    ],
    { skipLock: true },
  );

  return {
    player: ledger.player,
    transactions: ledger.transactions,
    saleValue,
    message: `Du solgte ${asset.name.toLowerCase()} for ${formatMoney(saleValue)}.`,
  };
}

/** Sells one asset. */
export async function sellAsset(playerId: string, assetId: string): Promise<SellResult> {
  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    return sellAssetTx(tx, playerId, assetId);
  });
}

/** The player's assets as they stand after an operation, inside the same tx. */
export async function assetsAfter(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<Asset[]> {
  return listAssetsTx(tx, playerId);
}
