import type { Request, Response } from 'express';
import {
  VEHICLE_TUNING,
  VEHICLE_TYPES,
  resolveDistrict,
  type VehicleActionResponse,
  type VehicleBuyResponse,
  type VehicleCatalogResponse,
  type VehicleDetailResponse,
  type VehicleListResponse,
  type VehicleSellResponse,
} from '@skyggeby/shared';
import {
  toPlayerDto,
  toTransactionDto,
  toVehicleCatalogEntryDto,
  toVehicleDto,
} from '../../lib/serialize';
import {
  parseOrThrow,
  vehicleActionSchema,
  vehicleBuySchema,
  vehicleIdParamSchema,
  vehicleMoveSchema,
} from '../../lib/validation';
import { syncVitals } from '../player/progression.service';
import {
  activateVehicle,
  buyVehicle,
  countVehicles,
  getVehicle,
  listVehicles,
  moveVehicle,
  parkVehicle,
  sellVehicle,
  type VehicleWithAsset,
} from './vehicle.service';

/** Serialises a whole garage against the district the player is standing in. */
function toList(vehicles: VehicleWithAsset[], playerDistrictId: string) {
  return vehicles.map((vehicle) => toVehicleDto(vehicle, playerDistrictId));
}

function activeOf(vehicles: VehicleWithAsset[], playerDistrictId: string) {
  const active = vehicles.find((vehicle) => vehicle.isActive);
  return active ? toVehicleDto(active, playerDistrictId) : null;
}

export async function getVehicles(req: Request, res: Response) {
  const { vehicles, player } = await listVehicles(req.player!.id);
  const district = resolveDistrict(player.currentDistrictId);

  const body: VehicleListResponse = {
    vehicles: toList(vehicles, player.currentDistrictId),
    active: activeOf(vehicles, player.currentDistrictId),
    count: vehicles.length,
    maxVehicles: VEHICLE_TUNING.maxVehicles,
    playerDistrictId: district.id,
    playerDistrictName: district.name,
  };
  res.status(200).json(body);
}

export async function getCatalog(req: Request, res: Response) {
  const player = await syncVitals(req.player!.id);
  const owned = await countVehicles(player.id);

  const body: VehicleCatalogResponse = {
    catalog: VEHICLE_TYPES.map((definition) =>
      toVehicleCatalogEntryDto(
        definition,
        player.cash,
        owned,
        VEHICLE_TUNING.maxVehicles,
      ),
    ),
    count: owned,
    maxVehicles: VEHICLE_TUNING.maxVehicles,
    player: toPlayerDto(player),
  };
  res.status(200).json(body);
}

export async function getVehicleById(req: Request, res: Response) {
  const { vehicleId } = parseOrThrow(vehicleIdParamSchema, req.params);

  const { vehicle, player } = await getVehicle(req.player!.id, vehicleId);

  const body: VehicleDetailResponse = {
    vehicle: toVehicleDto(vehicle, player.currentDistrictId),
  };
  res.status(200).json(body);
}

export async function postBuy(req: Request, res: Response) {
  // Only the type id and the name are read; price, district, condition and
  // ownership all come from the server.
  const { vehicleTypeId, name } = parseOrThrow(vehicleBuySchema, req.body);

  const result = await buyVehicle(req.player!.id, vehicleTypeId, name);
  const at = result.player.currentDistrictId;

  const body: VehicleBuyResponse = {
    vehicle: toVehicleDto(result.vehicle, at),
    vehicles: toList(result.vehicles, at),
    active: activeOf(result.vehicles, at),
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    message: result.message,
  };
  res.status(201).json(body);
}

export async function postActivate(req: Request, res: Response) {
  const { vehicleId } = parseOrThrow(vehicleActionSchema, req.body);

  const result = await activateVehicle(req.player!.id, vehicleId);
  const at = result.player.currentDistrictId;

  const body: VehicleActionResponse = {
    vehicle: toVehicleDto(result.vehicle, at),
    vehicles: toList(result.vehicles, at),
    active: activeOf(result.vehicles, at),
    message: result.message,
  };
  res.status(200).json(body);
}

export async function postPark(req: Request, res: Response) {
  const { vehicleId } = parseOrThrow(vehicleActionSchema, req.body);

  const result = await parkVehicle(req.player!.id, vehicleId);
  const at = result.player.currentDistrictId;

  const body: VehicleActionResponse = {
    vehicle: toVehicleDto(result.vehicle, at),
    vehicles: toList(result.vehicles, at),
    active: activeOf(result.vehicles, at),
    message: result.message,
  };
  res.status(200).json(body);
}

export async function postMove(req: Request, res: Response) {
  // The destination is the client's only say; everything it is checked against
  // comes from the player's own row.
  const { vehicleId, destinationDistrictId } = parseOrThrow(vehicleMoveSchema, req.body);

  const result = await moveVehicle(req.player!.id, vehicleId, destinationDistrictId);
  const at = result.player.currentDistrictId;

  const body: VehicleActionResponse = {
    vehicle: toVehicleDto(result.vehicle, at),
    vehicles: toList(result.vehicles, at),
    active: activeOf(result.vehicles, at),
    message: result.message,
  };
  res.status(200).json(body);
}

export async function postSell(req: Request, res: Response) {
  const { vehicleId } = parseOrThrow(vehicleActionSchema, req.body);

  const result = await sellVehicle(req.player!.id, vehicleId);
  const at = result.player.currentDistrictId;

  const body: VehicleSellResponse = {
    vehicles: toList(result.vehicles, at),
    active: activeOf(result.vehicles, at),
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    saleValue: result.saleValue,
    message: result.message,
  };
  res.status(200).json(body);
}
