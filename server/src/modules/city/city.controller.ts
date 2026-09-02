import type { Request, Response } from 'express';
import { resolveDistrict, type CityStateResponse, type MoveResponse } from '@skyggeby/shared';
import { toPlayerDto } from '../../lib/serialize';
import { moveSchema, parseOrThrow } from '../../lib/validation';
import { syncVitals } from '../player/progression.service';
import { buildCityState, moveToDistrict } from './city.service';

export async function getCity(req: Request, res: Response) {
  const player = await syncVitals(req.player!.id);

  const body: CityStateResponse = {
    districts: buildCityState(player),
    currentDistrictId: resolveDistrict(player.currentDistrictId).id,
    player: toPlayerDto(player),
  };
  res.status(200).json(body);
}

export async function postMove(req: Request, res: Response) {
  // The client may only name a district. Whether it exists, and whether the
  // player may go there, is decided server side.
  const { districtId } = parseOrThrow(moveSchema, req.body);

  const result = await moveToDistrict(req.player!.id, districtId);

  const body: MoveResponse = {
    player: toPlayerDto(result.player),
    districts: result.districts,
    currentDistrictId: resolveDistrict(result.player.currentDistrictId).id,
    message: result.message,
    moved: result.moved,
  };
  res.status(200).json(body);
}
