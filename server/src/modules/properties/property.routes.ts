import type { Request } from 'express';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import {
  getCatalog,
  getProperties,
  getPropertyById,
  postBuy,
  postSell,
} from './property.controller';

export const propertyRouter = Router();

propertyRouter.use(requireAuth);

/** Keyed on the account, so one player cannot spend another player's quota. */
const byPlayer = (req: Request) => req.player?.id ?? null;

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: 'properties.read',
  key: byPlayer,
  message: 'Du henter eiendommer for raskt. Vent litt.',
});

/** Buying moves money and takes a row lock, like every other purchase. */
const buyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'properties.buy',
  key: byPlayer,
  message: 'Du kjøper for raskt. Vent litt.',
});

const sellLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'properties.sell',
  key: byPlayer,
  message: 'Du selger for raskt. Vent litt.',
});

propertyRouter.get('/', readLimiter, asyncHandler(getProperties));
// Declared before the parameterised route, or "katalog" would be read as an id.
propertyRouter.get('/katalog', readLimiter, asyncHandler(getCatalog));
propertyRouter.post('/kjop', buyLimiter, asyncHandler(postBuy));
propertyRouter.post('/selg', sellLimiter, asyncHandler(postSell));
propertyRouter.get('/:propertyId', readLimiter, asyncHandler(getPropertyById));
