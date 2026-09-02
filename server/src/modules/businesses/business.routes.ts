import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import {
  getBusinessById,
  getBusinesses,
  getCatalog,
  postBuy,
  postWithdraw,
} from './business.controller';

export const businessRouter = Router();

businessRouter.use(requireAuth);

/**
 * Buying and withdrawing both take row locks and move money, so they get the
 * same treatment as the bank and the asset trade: room for any real player, and
 * a hard stop on scripted spam.
 */
const tradeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'businesses.trade',
  message: 'Du handler for raskt. Vent litt.',
});

businessRouter.get('/', asyncHandler(getBusinesses));
// Declared before the parameterised route, or "katalog" would be read as an id.
businessRouter.get('/katalog', asyncHandler(getCatalog));
businessRouter.post('/kjop', tradeLimiter, asyncHandler(postBuy));
businessRouter.post('/uttak', tradeLimiter, asyncHandler(postWithdraw));
businessRouter.get('/:businessId', asyncHandler(getBusinessById));
