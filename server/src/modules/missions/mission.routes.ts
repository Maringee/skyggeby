import type { Request } from 'express';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import {
  getMissionById,
  getMissions,
  postAbandon,
  postAccept,
  postDeliver,
} from './mission.controller';

export const missionRouter = Router();

missionRouter.use(requireAuth);

/** Keyed on the account, so one player cannot spend another player's quota. */
const byPlayer = (req: Request) => req.player?.id ?? null;

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: 'missions.read',
  key: byPlayer,
  message: 'Du henter oppdrag for raskt. Vent litt.',
});

/**
 * Writes take the player's row lock and, on delivery, move money. The limit is
 * generous enough that nobody playing normally will meet it, and tight enough
 * that a script cannot hammer the lock.
 */
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'missions.write',
  key: byPlayer,
  message: 'Du gjør dette for raskt. Vent litt.',
});

missionRouter.get('/', readLimiter, asyncHandler(getMissions));
missionRouter.get('/:missionId', readLimiter, asyncHandler(getMissionById));
missionRouter.post('/:missionId/godta', writeLimiter, asyncHandler(postAccept));
missionRouter.post('/:missionId/lever', writeLimiter, asyncHandler(postDeliver));
missionRouter.post('/:missionId/avbryt', writeLimiter, asyncHandler(postAbandon));
