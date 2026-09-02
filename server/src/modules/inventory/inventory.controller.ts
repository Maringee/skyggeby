import type { Request, Response } from 'express';
import type { InventoryActionResponse, InventoryResponse } from '@skyggeby/shared';
import { toInventoryItemDto } from '../../lib/serialize';
import { inventoryActionSchema, parseOrThrow } from '../../lib/validation';
import {
  addToInventory,
  getInventory,
  removeFromInventory,
} from './inventory.service';

/** Builds the whole page state from one read, so the two lists always agree. */
async function buildResponse(playerId: string): Promise<InventoryResponse> {
  const state = await getInventory(playerId);

  return {
    items: state.carried.map((asset) =>
      toInventoryItemDto(asset, state.usage.remainingSlots),
    ),
    stored: state.stored.map((asset) =>
      toInventoryItemDto(asset, state.usage.remainingSlots),
    ),
    usedSlots: state.usage.usedSlots,
    capacity: state.usage.capacity,
    remainingSlots: state.usage.remainingSlots,
  };
}

export async function getInventoryList(req: Request, res: Response) {
  res.status(200).json(await buildResponse(req.player!.id));
}

export async function postAdd(req: Request, res: Response) {
  // Only the asset id is read; slots, capacity and ownership are the server's.
  const { assetId } = parseOrThrow(inventoryActionSchema, req.body);

  const result = await addToInventory(req.player!.id, assetId);

  const body: InventoryActionResponse = {
    ...(await buildResponse(req.player!.id)),
    message: result.message,
  };
  res.status(200).json(body);
}

export async function postRemove(req: Request, res: Response) {
  const { assetId } = parseOrThrow(inventoryActionSchema, req.body);

  const result = await removeFromInventory(req.player!.id, assetId);

  const body: InventoryActionResponse = {
    ...(await buildResponse(req.player!.id)),
    message: result.message,
  };
  res.status(200).json(body);
}
