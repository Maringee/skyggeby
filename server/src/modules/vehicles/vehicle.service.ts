import type { Asset, Player, Prisma, Transaction, Vehicle } from '@prisma/client';
import {
  findVehicleType,
  formatMoney,
  isDistrictId,
  resolveDistrict,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { lockPlayer } from '../economy/transaction.service';
import { advanceMissionProgressTx } from '../missions/mission.progress';
import { buyAssetTx, sellAssetTx } from '../assets/asset.service';

/** A vehicle together with the asset that holds its money side. */
const WITH_ASSET = { asset: true } satisfies Prisma.VehicleInclude;

export type VehicleWithAsset = Vehicle & { asset: Asset };

export interface VehicleState {
  vehicles: VehicleWithAsset[];
  player: Player;
}

export interface VehicleActionResult extends VehicleState {
  vehicle: VehicleWithAsset;
  message: string;
}

export interface VehicleBuyResult extends VehicleActionResult {
  transactions: Transaction[];
}

export interface VehicleSellResult extends VehicleState {
  transactions: Transaction[];
  saleValue: number;
  message: string;
}

/* ------------------------------------------------------------------ *
 * Locking and reading
 * ------------------------------------------------------------------ */

/**
 * Serialises concurrent writes to one player's vehicles.
 *
 * Always taken *after* `lockPlayer`, never before: one lock order across every
 * path - buy, activate, park, move, sell - is what keeps two requests from
 * deadlocking against each other.
 */
async function lockVehicles(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM vehicles WHERE "playerId" = ${playerId} ORDER BY id FOR UPDATE`;
}

async function vehiclesTx(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<VehicleWithAsset[]> {
  return tx.vehicle.findMany({
    where: { playerId },
    include: WITH_ASSET,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });
}

async function playerTx(tx: Prisma.TransactionClient, playerId: string): Promise<Player> {
  const player = await tx.player.findUnique({ where: { id: playerId } });
  if (!player) throw notFound('Fant ikke spilleren.');
  return player;
}

/**
 * One vehicle, scoped to its owner.
 *
 * A vehicle somebody else owns answers exactly the way one that does not exist
 * does, so an id alone reveals nothing about anyone else's garage.
 */
async function ownedVehicleTx(
  tx: Prisma.TransactionClient,
  playerId: string,
  vehicleId: string,
): Promise<VehicleWithAsset> {
  const row = await tx.vehicle.findFirst({
    where: { id: vehicleId, playerId },
    include: WITH_ASSET,
  });

  if (!row) throw notFound('Fant ikke dette kjøretøyet.');
  return row;
}

/** Everything the player owns, with the player row the page needs alongside. */
export async function listVehicles(playerId: string): Promise<VehicleState> {
  const [vehicles, player] = await Promise.all([
    prisma.vehicle.findMany({
      where: { playerId },
      include: WITH_ASSET,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    }),
    prisma.player.findUnique({ where: { id: playerId } }),
  ]);

  if (!player) throw notFound('Fant ikke spilleren.');
  return { vehicles, player };
}

export async function getVehicle(
  playerId: string,
  vehicleId: string,
): Promise<{ vehicle: VehicleWithAsset; player: Player }> {
  const [vehicle, player] = await Promise.all([
    prisma.vehicle.findFirst({ where: { id: vehicleId, playerId }, include: WITH_ASSET }),
    prisma.player.findUnique({ where: { id: playerId } }),
  ]);

  if (!vehicle) throw notFound('Fant ikke dette kjøretøyet.');
  if (!player) throw notFound('Fant ikke spilleren.');

  return { vehicle, player };
}

export async function countVehicles(playerId: string): Promise<number> {
  return prisma.vehicle.count({ where: { playerId } });
}

/* ------------------------------------------------------------------ *
 * Buying
 * ------------------------------------------------------------------ */

/**
 * Buys one vehicle from the catalogue.
 *
 * The client names a type and picks a name; the price, the district and the
 * asset behind it are the server's. The purchase runs through the existing
 * asset service inside this transaction, so a vehicle is bought exactly the way
 * every other thing in the game is bought - one ledger, one transaction row,
 * one place where money can move.
 *
 * The player row lock is what enforces the ceiling: every purchase for one
 * player is serialised, so the count read inside the transaction is the truth.
 */
export async function buyVehicle(
  playerId: string,
  vehicleTypeId: string,
  name: string,
): Promise<VehicleBuyResult> {
  const definition = findVehicleType(vehicleTypeId);
  if (!definition) {
    throw notFound('Dette kjøretøyet finnes ikke.');
  }

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);

    const result = await buyAssetTx(tx, playerId, definition, { vehicleName: name });
    if (!result.vehicle) {
      // Unreachable: the catalogue only contains vehicles.
      throw badRequest('Denne typen kan ikke registreres som kjøretøy.');
    }

    const vehicle = await tx.vehicle.findUniqueOrThrow({
      where: { id: result.vehicle.id },
      include: WITH_ASSET,
    });
    const district = resolveDistrict(vehicle.locationDistrictId);

    return {
      vehicle,
      vehicles: await vehiclesTx(tx, playerId),
      player: result.player,
      transactions: result.transactions,
      message: `Du kjøpte ${definition.name.toLowerCase()} for ${formatMoney(
        definition.purchasePrice,
      )}. ${name} står parkert i ${district.name}.`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Activating and parking
 * ------------------------------------------------------------------ */

/**
 * Makes one vehicle the active one.
 *
 * You can only get behind the wheel of a car you are standing next to, so the
 * vehicle's district must match the player's - read from their locked row, not
 * from the request. Deactivating the old one and activating the new one happen
 * in the same transaction, and a partial unique index in the database refuses a
 * second active vehicle even if some future code path forgets.
 */
export async function activateVehicle(
  playerId: string,
  vehicleId: string,
): Promise<VehicleActionResult> {
  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await lockVehicles(tx, playerId);

    const player = await playerTx(tx, playerId);
    const vehicle = await ownedVehicleTx(tx, playerId, vehicleId);

    if (vehicle.locationDistrictId !== player.currentDistrictId) {
      const where = resolveDistrict(vehicle.locationDistrictId);
      throw new AppError(
        400,
        'ANNET_DISTRIKT',
        `Kjøretøyet står i et annet distrikt. ${vehicle.name} står i ${where.name}.`,
      );
    }

    if (vehicle.isActive) {
      return {
        vehicle,
        vehicles: await vehiclesTx(tx, playerId),
        player,
        message: `${vehicle.name} er allerede aktivt.`,
      };
    }

    // Park whatever was active first: one player, one wheel.
    await tx.vehicle.updateMany({
      where: { playerId, isActive: true },
      data: { isActive: false },
    });

    const claimed = await tx.vehicle.updateMany({
      where: {
        id: vehicleId,
        playerId,
        isActive: false,
        locationDistrictId: player.currentDistrictId,
      },
      data: { isActive: true },
    });

    if (claimed.count !== 1) {
      throw new AppError(409, 'KUNNE_IKKE_AKTIVERE', 'Kjøretøyet kunne ikke aktiveres.');
    }

    const updated = await ownedVehicleTx(tx, playerId, vehicleId);

    return {
      vehicle: updated,
      vehicles: await vehiclesTx(tx, playerId),
      player,
      message: `${updated.name} er nå aktivt kjøretøy.`,
    };
  });
}

/**
 * Parks a vehicle.
 *
 * Parking only clears the active flag - it never moves anything. A vehicle
 * parked in Neon is still in Neon.
 */
export async function parkVehicle(
  playerId: string,
  vehicleId: string,
): Promise<VehicleActionResult> {
  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await lockVehicles(tx, playerId);

    const player = await playerTx(tx, playerId);
    const vehicle = await ownedVehicleTx(tx, playerId, vehicleId);

    const claimed = await tx.vehicle.updateMany({
      where: { id: vehicleId, playerId, isActive: true },
      data: { isActive: false },
    });

    const updated = await ownedVehicleTx(tx, playerId, vehicleId);

    return {
      vehicle: updated,
      vehicles: await vehiclesTx(tx, playerId),
      player,
      message:
        claimed.count === 1
          ? `${vehicle.name} er parkert i ${resolveDistrict(vehicle.locationDistrictId).name}.`
          : `${vehicle.name} var allerede parkert.`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Moving
 * ------------------------------------------------------------------ */

/**
 * Drives a vehicle to another district.
 *
 * The player does not come along. This is the point of the whole system: after
 * the drive the car is in Neon and the player is still in Blokkene, and getting
 * it back is a decision they have to make.
 *
 * Everything is checked against server state: the vehicle must be theirs, must
 * be the active one, and must currently stand where the player stands. The
 * destination is the only thing the client chooses, and it is validated against
 * the district catalogue before it can reach a row.
 */
export async function moveVehicle(
  playerId: string,
  vehicleId: string,
  destinationDistrictId: string,
): Promise<VehicleActionResult> {
  if (!isDistrictId(destinationDistrictId)) {
    throw badRequest('Ukjent distrikt.');
  }

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await lockVehicles(tx, playerId);

    const player = await playerTx(tx, playerId);
    const vehicle = await ownedVehicleTx(tx, playerId, vehicleId);

    if (!vehicle.isActive) {
      throw new AppError(
        400,
        'IKKE_AKTIVT',
        'Du må aktivere kjøretøyet før du kan kjøre det.',
      );
    }

    if (vehicle.locationDistrictId !== player.currentDistrictId) {
      const where = resolveDistrict(vehicle.locationDistrictId);
      throw new AppError(
        400,
        'ANNET_DISTRIKT',
        `Kjøretøyet står i et annet distrikt. ${vehicle.name} står i ${where.name}.`,
      );
    }

    if (vehicle.locationDistrictId === destinationDistrictId) {
      throw badRequest('Kjøretøyet står allerede der.', 'ALLEREDE_DER');
    }

    const from = resolveDistrict(vehicle.locationDistrictId);
    const to = resolveDistrict(destinationDistrictId);

    // Conditional on where it stood: two simultaneous drives cannot both move
    // the same car, and the second finds nothing to move.
    const claimed = await tx.vehicle.updateMany({
      where: { id: vehicleId, playerId, locationDistrictId: from.id },
      data: { locationDistrictId: to.id },
    });

    if (claimed.count !== 1) {
      throw new AppError(409, 'ALLEREDE_FLYTTET', 'Kjøretøyet er allerede flyttet.');
    }

    // Driving a car somewhere is not the same as going there yourself, and
    // a mission that asks for both is asking for two separate things.
    await advanceMissionProgressTx(tx, playerId, {
      kind: 'KJOR',
      districtId: to.id,
    });

    const updated = await ownedVehicleTx(tx, playerId, vehicleId);

    return {
      vehicle: updated,
      vehicles: await vehiclesTx(tx, playerId),
      player,
      message: `${updated.name} står nå i ${to.name}. Du er fortsatt i ${
        resolveDistrict(player.currentDistrictId).name
      }.`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Selling
 * ------------------------------------------------------------------ */

/**
 * Sells a vehicle.
 *
 * There is no separate economy here: the sale is the existing asset sale, run
 * inside this transaction. Deleting the asset takes the vehicle row with it by
 * cascade, so a sold car cannot stay active, cannot stay owned, and cannot
 * leave a row behind for a later request to find.
 */
export async function sellVehicle(
  playerId: string,
  vehicleId: string,
): Promise<VehicleSellResult> {
  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await lockVehicles(tx, playerId);

    const vehicle = await ownedVehicleTx(tx, playerId, vehicleId);
    const sale = await sellAssetTx(tx, playerId, vehicle.assetId);

    return {
      vehicles: await vehiclesTx(tx, playerId),
      player: sale.player,
      transactions: sale.transactions,
      saleValue: sale.saleValue,
      message: `Du solgte ${vehicle.name} for ${formatMoney(sale.saleValue)}.`,
    };
  });
}

/** The active vehicle, or null. Used by the serialiser and the tests. */
export function activeVehicle(vehicles: VehicleWithAsset[]): VehicleWithAsset | null {
  return vehicles.find((vehicle) => vehicle.isActive) ?? null;
}
