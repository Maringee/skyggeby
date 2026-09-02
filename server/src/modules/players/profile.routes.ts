import type { Request } from 'express';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import { getPlayerSearch, getPublicProfile } from './profile.controller';

export const profileRouter = Router();

/**
 * "Public" means public to the city, not to the internet: everything in
 * Skyggeby is behind a session, and profiles are no exception.
 */
profileRouter.use(requireAuth);

/** Keyed on the account, so one player cannot spend another player's quota. */
const byPlayer = (req: Request) => req.player?.id ?? null;

const profileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: 'players.profile',
  key: byPlayer,
  message: 'Du åpner profiler for raskt. Vent litt.',
});

/** Searching hits an index scan, so it gets the tighter quota of the two. */
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyPrefix: 'players.search',
  key: byPlayer,
  message: 'Du søker for raskt. Vent litt.',
});

// Declared before the parameterised route, or "sok" would be read as a name.
profileRouter.get('/sok', searchLimiter, asyncHandler(getPlayerSearch));
profileRouter.get('/:username', profileLimiter, asyncHandler(getPublicProfile));
