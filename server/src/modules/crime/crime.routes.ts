import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import { getCrimes, postCrime } from './crime.controller';

export const crimeRouter = Router();

crimeRouter.use(requireAuth);

// Per-crime cooldowns are the real limiter; this only blunts request floods.
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  keyPrefix: 'crime',
  message: 'Du sender for mange forespørsler. Ro ned litt.',
});

crimeRouter.get('/', asyncHandler(getCrimes));
crimeRouter.post('/:crimeId', actionLimiter, asyncHandler(postCrime));
