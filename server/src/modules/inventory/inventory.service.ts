import type { Asset, Prisma } from '@prisma/client';
import {
  ASSET_CARRY_BLOCK_REASONS,
  INVENTORY_CAPACITY,
  canCarryStatus,
  findAssetType,
  inventorySlotsFor,
  isInventoryEligible,
  type AssetStatus,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, notFound } from '../../lib/errors';
import { lockPlayer } from '../economy/transaction.service';

/**
 * The inventory is not a second table. An asset is a single row, and whether it
 * is carried is one field on that row — so nothing can be duplicated, lost
 * between tables, or drift out of sync with what the player actually owns.
 */

export interface InventoryUsage {
  usedSlots: number;
  capacity: number;
  remainingSlots: number;
}

export interface InventoryState {
  /** Assets currently carried. */
  carried: Asset[];
  /** Assets owned but not carried. */
  stored: Asset[];
  usage: InventoryUsage;
}

export interface InventoryChange {
  asset: Asset;
  usage: InventoryUsage;
  message: string;
}

/**
 * The one place inventory usage is computed.
 *
 * Takes every asset a player owns and works out what is carried, so no caller
 * has to remember to filter first or to look slot costs up itself. Slot costs
 * come from the catalogue; a type that is no longer in it counts as zero rather
 * than breaking the sum.
 */
export function calculateInventoryUsage(assets: Asset[]): InventoryUsage {
  const usedSlots = assets
    .filter((asset) => asset.storageLocation === 'INVENTORY')
    .reduce((sum, asset) => sum + inventorySlotsFor(asset.assetTypeId), 0);

  return {
    usedSlots,
    capacity: INVENTORY_CAPACITY,
    remainingSlots: Math.max(0, INVENTORY_CAPACITY - usedSlots),
  };
}

async function allAssets(playerId: string): Promise<Asset[]> {
  return prisma.asset.findMany({
    where: { playerId },
    orderBy: [{ purchasedAt: 'desc' }],
    take: 500,
  });
}

async function allAssetsTx(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<Asset[]> {
  return tx.asset.findMany({ where: { playerId } });
}

/** Everything the player owns, split by whether it is carried. */
export async function getInventory(playerId: string): Promise<InventoryState> {
  const assets = await allAssets(playerId);

  return {
    carried: assets.filter((asset) => asset.storageLocation === 'INVENTORY'),
    stored: assets.filter((asset) => asset.storageLocation !== 'INVENTORY'),
    usage: calculateInventoryUsage(assets),
  };
}

/**
 * Puts one asset in the inventory.
 *
 * Capacity is checked under the player's row lock, so two requests racing for
 * the last slot cannot both pass the check. The update is additionally scoped
 * to `storageLocation: STORED`, which makes the write itself the claim: only
 * the caller that actually moved the row succeeds.
 */
export async function addToInventory(
  playerId: string,
  assetId: string,
): Promise<InventoryChange> {
  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);

    const asset = await tx.asset.findFirst({ where: { id: assetId, playerId } });
    if (!asset) {
      // Same answer whether it never existed or belongs to someone else.
      throw notFound('Eiendelen finnes ikke.');
    }

    const definition = findAssetType(asset.assetTypeId);
    if (!definition || !isInventoryEligible(asset.assetTypeId)) {
      throw new AppError(400, 'KAN_IKKE_BAERES', 'Denne eiendelen kan ikke bæres.');
    }

    const status = asset.status as AssetStatus;
    if (!canCarryStatus(status)) {
      throw new AppError(
        400,
        'KAN_IKKE_BAERES',
        ASSET_CARRY_BLOCK_REASONS[status] ?? 'Denne eiendelen kan ikke bæres.',
      );
    }

    if (asset.storageLocation === 'INVENTORY') {
      throw new AppError(
        400,
        'ALLEREDE_I_INVENTAR',
        'Eiendelen ligger allerede i inventaret.',
      );
    }

    const usage = calculateInventoryUsage(await allAssetsTx(tx, playerId));
    const slots = definition.inventorySlots;

    if (slots > usage.remainingSlots) {
      throw new AppError(
        400,
        'INGEN_PLASS',
        usage.remainingSlots === 0
          ? 'Inventaret er fullt.'
          : `Ikke nok plass. ${definition.name} krever ${slots} plasser, du har ${usage.remainingSlots} ledig.`,
      );
    }

    const moved = await tx.asset.updateMany({
      where: { id: assetId, playerId, storageLocation: 'STORED' },
      data: { storageLocation: 'INVENTORY' },
    });

    if (moved.count !== 1) {
      throw new AppError(
        409,
        'ALLEREDE_I_INVENTAR',
        'Eiendelen ligger allerede i inventaret.',
      );
    }

    const updated = await tx.asset.findFirstOrThrow({ where: { id: assetId, playerId } });

    return {
      asset: updated,
      usage: calculateInventoryUsage(await allAssetsTx(tx, playerId)),
      message: `${definition.name} ble lagt i inventaret.`,
    };
  });
}

/**
 * Takes one asset out of the inventory.
 *
 * No money moves, nothing is booked, and the district the asset sits in is left
 * exactly as it was — carrying something is not transporting it.
 */
export async function removeFromInventory(
  playerId: string,
  assetId: string,
): Promise<InventoryChange> {
  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);

    const asset = await tx.asset.findFirst({ where: { id: assetId, playerId } });
    if (!asset) {
      throw notFound('Eiendelen finnes ikke.');
    }

    const moved = await tx.asset.updateMany({
      where: { id: assetId, playerId, storageLocation: 'INVENTORY' },
      data: { storageLocation: 'STORED' },
    });

    if (moved.count !== 1) {
      throw new AppError(
        400,
        'IKKE_I_INVENTAR',
        'Eiendelen ligger ikke i inventaret.',
      );
    }

    const updated = await tx.asset.findFirstOrThrow({ where: { id: assetId, playerId } });

    return {
      asset: updated,
      usage: calculateInventoryUsage(await allAssetsTx(tx, playerId)),
      message: `${asset.name} ble tatt ut av inventaret.`,
    };
  });
}
