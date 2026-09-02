import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import { getInventoryList, postAdd, postRemove } from './inventory.controller';

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

/**
 * No money moves here and there is no cooldown, so the limiter exists only to
 * stop a client hammering a locked transaction it gains nothing from.
 */
const inventoryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'inventory.move',
  message: 'Du endrer inventaret for raskt. Vent litt.',
});

inventoryRouter.get('/', asyncHandler(getInventoryList));
inventoryRouter.post('/legg-inn', inventoryLimiter, asyncHandler(postAdd));
inventoryRouter.post('/ta-ut', inventoryLimiter, asyncHandler(postRemove));
