import type { Request, Response } from 'express';
import {
  INFORMATION_TUNING,
  resolveDistrict,
  type ExploreResponse,
  type InformationListResponse,
} from '@skyggeby/shared';
import { toInformationDto, toPlayerDto } from '../../lib/serialize';
import { informationIdSchema, parseOrThrow } from '../../lib/validation';
import { syncVitals } from '../player/progression.service';
import {
  exploreCooldownRemaining,
  exploreCurrentDistrict,
  getInformation,
  listInformation,
} from './information.service';

export async function getInformationList(req: Request, res: Response) {
  const player = await syncVitals(req.player!.id);
  const now = new Date();
  const district = resolveDistrict(player.currentDistrictId);

  const rows = await listInformation(player.id);

  const body: InformationListResponse = {
    information: rows.map((row) => toInformationDto(row, now)),
    exploreCooldownSeconds: exploreCooldownRemaining(player, now),
    exploreEnergyCost: INFORMATION_TUNING.exploreEnergyCost,
    player: toPlayerDto(player),
    districtId: district.id,
    districtName: district.name,
  };
  res.status(200).json(body);
}

export async function getInformationById(req: Request, res: Response) {
  const { id } = parseOrThrow(informationIdSchema, req.params);
  const row = await getInformation(req.player!.id, id);
  res.status(200).json({ information: toInformationDto(row) });
}

export async function postExplore(req: Request, res: Response) {
  // The client sends nothing at all. Where, what it costs and what turns up are
  // all read or decided server side.
  const result = await exploreCurrentDistrict(req.player!.id);

  const player = await syncVitals(req.player!.id);
  const now = new Date();
  const rows = await listInformation(player.id);

  const body: ExploreResponse = {
    found: result.found ? toInformationDto(result.found, now) : null,
    message: result.message,
    energySpent: result.energySpent,
    exploreCooldownSeconds: exploreCooldownRemaining(player, now),
    player: toPlayerDto(player),
    information: rows.map((row) => toInformationDto(row, now)),
  };
  res.status(200).json(body);
}
