import type { Request, Response } from 'express';
import {
  BUSINESS_TUNING,
  BUSINESS_TYPES,
  calculateBusinessValue,
  findBusinessType,
  type BusinessBuyResponse,
  type BusinessCatalogResponse,
  type BusinessDetailResponse,
  type BusinessListResponse,
  type BusinessWithdrawResponse,
} from '@skyggeby/shared';
import {
  toBusinessCatalogEntryDto,
  toBusinessDto,
  toPlayerDto,
  toTransactionDto,
} from '../../lib/serialize';
import {
  businessBuySchema,
  businessIdParamSchema,
  businessWithdrawSchema,
  parseOrThrow,
} from '../../lib/validation';
import { syncVitals } from '../player/progression.service';
import {
  buyBusiness,
  countBusinesses,
  getBusiness,
  listBusinesses,
  withdrawFromBusiness,
} from './business.service';

/** Display estimate for a set of businesses, read from the catalogue. */
function totalValueOf(rows: Array<{ businessTypeId: string; condition: number }>): number {
  return rows.reduce(
    (sum, row) =>
      sum +
      calculateBusinessValue(
        findBusinessType(row.businessTypeId)?.purchasePrice ?? 0,
        row.condition,
      ),
    0,
  );
}

export async function getBusinesses(req: Request, res: Response) {
  // Reading the list settles it, so the numbers below are current.
  const result = await listBusinesses(req.player!.id);

  const body: BusinessListResponse = {
    businesses: result.businesses.map(toBusinessDto),
    count: result.businesses.length,
    maxBusinesses: BUSINESS_TUNING.maxBusinesses,
    totalValue: totalValueOf(result.businesses),
    earned: result.earned,
  };
  res.status(200).json(body);
}

export async function getCatalog(req: Request, res: Response) {
  const player = await syncVitals(req.player!.id);
  const owned = await countBusinesses(player.id);

  const body: BusinessCatalogResponse = {
    catalog: BUSINESS_TYPES.map((definition) =>
      toBusinessCatalogEntryDto(definition, player.cash, owned),
    ),
    count: owned,
    maxBusinesses: BUSINESS_TUNING.maxBusinesses,
    player: toPlayerDto(player),
  };
  res.status(200).json(body);
}

export async function getBusinessById(req: Request, res: Response) {
  const { businessId } = parseOrThrow(businessIdParamSchema, req.params);

  const result = await getBusiness(req.player!.id, businessId);

  const body: BusinessDetailResponse = {
    business: toBusinessDto(result.business),
    earned: result.earned,
  };
  res.status(200).json(body);
}

export async function postBuy(req: Request, res: Response) {
  // Only the type id and the name are read; price, district, rates, condition,
  // activity and risk all come from the server's catalogue.
  const { businessTypeId, name } = parseOrThrow(businessBuySchema, req.body);

  const result = await buyBusiness(req.player!.id, businessTypeId, name);

  const body: BusinessBuyResponse = {
    business: toBusinessDto(result.business),
    businesses: result.businesses.map(toBusinessDto),
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    message: result.message,
  };
  res.status(201).json(body);
}

export async function postWithdraw(req: Request, res: Response) {
  const { businessId } = parseOrThrow(businessWithdrawSchema, req.body);

  const result = await withdrawFromBusiness(req.player!.id, businessId);

  const body: BusinessWithdrawResponse = {
    business: toBusinessDto(result.business),
    businesses: result.businesses.map(toBusinessDto),
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    amount: result.amount,
    message: result.message,
  };
  res.status(200).json(body);
}
