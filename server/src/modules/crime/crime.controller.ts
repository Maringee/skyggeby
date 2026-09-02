import type { Request, Response } from 'express';
import { resolveDistrict } from '@skyggeby/shared';
import type { CrimeActionResponse, CrimeListResponse } from '@skyggeby/shared';
import { badRequest } from '../../lib/errors';
import { toCrimeOutcomeDto, toPlayerDto, toTransactionDto } from '../../lib/serialize';
import { syncVitals } from '../player/progression.service';
import { listCrimesForPlayer, performCrime } from './crime.service';

export async function getCrimes(req: Request, res: Response) {
  // Settle passive energy/heat first so the list reflects reality.
  const player = await syncVitals(req.player!.id);

  const district = resolveDistrict(player.currentDistrictId);

  const body: CrimeListResponse = {
    crimes: await listCrimesForPlayer(player),
    player: toPlayerDto(player),
    district: { districtId: district.id, districtName: district.name },
  };
  res.status(200).json(body);
}

export async function postCrime(req: Request, res: Response) {
  const crimeId = req.params.crimeId;
  if (typeof crimeId !== 'string' || crimeId.length === 0) {
    throw badRequest('Du må oppgi hvilken kriminalitet du vil utføre.');
  }

  // The client sends nothing but the crime id - the server decides the rest.
  const result = await performCrime(req.player!.id, crimeId);

  const body: CrimeActionResponse = {
    outcome: toCrimeOutcomeDto(result.outcome),
    player: toPlayerDto(result.player),
    transactions: result.transactions.map(toTransactionDto),
    crimes: await listCrimesForPlayer(result.player),
    district: {
      districtId: result.district.id,
      districtName: result.district.name,
    },
  };
  res.status(200).json(body);
}
