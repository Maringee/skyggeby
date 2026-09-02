import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import {
  getInformationById,
  getInformationList,
  postExplore,
} from './information.controller';

export const informationRouter = Router();

informationRouter.use(requireAuth);

/**
 * A five minute cooldown already limits exploring, per player. This limiter is
 * about the endpoint rather than the game: it stops a client hammering a
 * locked, transactional write it cannot win anyway.
 */
const exploreLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'information.explore',
  message: 'Du leter for ofte. Vent litt.',
});

informationRouter.get('/', asyncHandler(getInformationList));
informationRouter.post('/utforsk', exploreLimiter, asyncHandler(postExplore));
informationRouter.get('/:id', asyncHandler(getInformationById));
