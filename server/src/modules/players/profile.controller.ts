import type { Request, Response } from 'express';
import type { PlayerSearchResponse, PublicProfileResponse } from '@skyggeby/shared';
import { toPlayerSearchResultDto, toPublicProfileDto } from '../../lib/serialize';
import {
  parseOrThrow,
  playerSearchQuerySchema,
  usernameParamSchema,
} from '../../lib/validation';
import { findPublicProfile, searchPlayers } from './profile.service';

export async function getPublicProfile(req: Request, res: Response) {
  const { username } = parseOrThrow(usernameParamSchema, req.params);

  const row = await findPublicProfile(username);

  const body: PublicProfileResponse = {
    profile: toPublicProfileDto(row, req.player!.id),
  };
  res.status(200).json(body);
}

export async function getPlayerSearch(req: Request, res: Response) {
  // Only the search term is read; the row cap and the columns are the server's.
  const { sok } = parseOrThrow(playerSearchQuerySchema, req.query);

  const rows = await searchPlayers(sok);

  const body: PlayerSearchResponse = {
    players: rows.map(toPlayerSearchResultDto),
    count: rows.length,
  };
  res.status(200).json(body);
}
