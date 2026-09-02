import type { Request, Response } from 'express';
import {
  ASSET_TYPES,
  calculateSaleValue,
  type AssetBuyResponse,
  type AssetCatalogResponse,
  type AssetListResponse,
  type AssetSellResponse,
} from '@skyggeby/shared';
import {
  toAssetCatalogEntryDto,
  toAssetDto,
  toPlayerDto,
  toTransactionDto,
} from '../../lib/serialize';
import { assetBuySchema, assetSellSchema, parseOrThrow } from '../../lib/validation';
import { syncVitals } from '../player/progression.service';
import { buyAsset, listAssets, sellAsset } from './asset.service';

export async function getAssets(req: Request, res: Response) {
  const player = await syncVitals(req.player!.id);
  const rows = await listAssets(player.id);

  const body: AssetListResponse = {
    assets: rows.map(toAssetDto),
    totalValue: rows.reduce((sum, row) => sum + row.currentValue, 0),
    totalSaleValue: rows.reduce(
      (sum, row) => sum + calculateSaleValue(row.purchasePrice, row.condition),
      0,
    ),
    count: rows.length,
    player: toPlayerDto(player),
  };
  res.status(200).json(body);
}

export async function getCatalog(req: Request, res: Response) {
  const player = await syncVitals(req.player!.id);

  const body: AssetCatalogResponse = {
    catalog: ASSET_TYPES.map((definition) =>
      toAssetCatalogEntryDto(definition, player.cash),
    ),
    player: toPlayerDto(player),
  };
  res.status(200).json(body);
}

export async function postBuy(req: Request, res: Response) {
  // Only the type id is read; the price and district come from the server.
  const { assetTypeId } = parseOrThrow(assetBuySchema, req.body);

  const result = await buyAsset(req.player!.id, assetTypeId);
  const rows = await listAssets(req.player!.id);

  const body: AssetBuyResponse = {
    asset: toAssetDto(result.asset),
    assets: rows.map(toAssetDto),
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    message: result.message,
  };
  res.status(201).json(body);
}

export async function postSell(req: Request, res: Response) {
  const { assetId } = parseOrThrow(assetSellSchema, req.body);

  const result = await sellAsset(req.player!.id, assetId);
  const rows = await listAssets(req.player!.id);

  const body: AssetSellResponse = {
    assets: rows.map(toAssetDto),
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    saleValue: result.saleValue,
    message: result.message,
  };
  res.status(200).json(body);
}
