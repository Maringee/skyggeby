import type { Request, Response } from 'express';
import {
  PROPERTY_TUNING,
  PROPERTY_TYPES,
  type PropertyBuyResponse,
  type PropertyCatalogResponse,
  type PropertyDetailResponse,
  type PropertyListResponse,
  type PropertySellResponse,
} from '@skyggeby/shared';
import {
  toPlayerDto,
  toPropertyCatalogEntryDto,
  toPropertyDto,
  toTransactionDto,
} from '../../lib/serialize';
import {
  parseOrThrow,
  propertyActionSchema,
  propertyBuySchema,
  propertyIdParamSchema,
} from '../../lib/validation';
import { syncVitals } from '../player/progression.service';
import {
  buyProperty,
  countProperties,
  getProperty,
  listProperties,
  sellProperty,
} from './property.service';

/** Sum of what the player's places are worth, from the rows themselves. */
function totalValueOf(rows: Array<{ currentValue: number }>): number {
  return rows.reduce((sum, row) => sum + row.currentValue, 0);
}

export async function getProperties(req: Request, res: Response) {
  const rows = await listProperties(req.player!.id);

  const body: PropertyListResponse = {
    properties: rows.map(toPropertyDto),
    count: rows.length,
    maxProperties: PROPERTY_TUNING.maxProperties,
    totalValue: totalValueOf(rows),
  };
  res.status(200).json(body);
}

export async function getCatalog(req: Request, res: Response) {
  const player = await syncVitals(req.player!.id);
  const owned = await countProperties(player.id);

  const body: PropertyCatalogResponse = {
    catalog: PROPERTY_TYPES.map((definition) =>
      toPropertyCatalogEntryDto(
        definition,
        player.cash,
        owned,
        PROPERTY_TUNING.maxProperties,
      ),
    ),
    count: owned,
    maxProperties: PROPERTY_TUNING.maxProperties,
    player: toPlayerDto(player),
  };
  res.status(200).json(body);
}

export async function getPropertyById(req: Request, res: Response) {
  const { propertyId } = parseOrThrow(propertyIdParamSchema, req.params);

  const row = await getProperty(req.player!.id, propertyId);

  const body: PropertyDetailResponse = { property: toPropertyDto(row) };
  res.status(200).json(body);
}

export async function postBuy(req: Request, res: Response) {
  // Only the type id and the name are read; price, district, condition,
  // capacity and security all come from the server's catalogue.
  const { propertyTypeId, name } = parseOrThrow(propertyBuySchema, req.body);

  const result = await buyProperty(req.player!.id, propertyTypeId, name);

  const body: PropertyBuyResponse = {
    property: toPropertyDto(result.property),
    properties: result.properties.map(toPropertyDto),
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    message: result.message,
  };
  res.status(201).json(body);
}

export async function postSell(req: Request, res: Response) {
  const { propertyId } = parseOrThrow(propertyActionSchema, req.body);

  const result = await sellProperty(req.player!.id, propertyId);

  const body: PropertySellResponse = {
    properties: result.properties.map(toPropertyDto),
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    saleValue: result.saleValue,
    message: result.message,
  };
  res.status(200).json(body);
}
