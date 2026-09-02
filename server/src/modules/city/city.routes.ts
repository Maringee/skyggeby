import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import { getCity, postMove } from './city.controller';

export const cityRouter = Router();

cityRouter.use(requireAuth);

/**
 * Moving takes a row lock, so a flood of moves would serialise and tie up
 * connections. Movement is deliberately free and has no cooldown, so the cap is
 * set well above what a person clicking around the map could reach - it exists
 * only to stop scripted write-spam.
 */
const moveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyPrefix: 'city.move',
  message: 'Du flytter deg for ofte. Vent litt.',
});

cityRouter.get('/', asyncHandler(getCity));
cityRouter.post('/flytt', moveLimiter, asyncHandler(postMove));
