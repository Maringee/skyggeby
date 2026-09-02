import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import { getAssets, getCatalog, postBuy, postSell } from './asset.controller';

export const assetRouter = Router();

assetRouter.use(requireAuth);

/**
 * Buying and selling both take a row lock and move money, so the endpoints get
 * the same treatment as the bank: enough headroom for any real player, and a
 * hard stop on scripted spam.
 */
const tradeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'assets.trade',
  message: 'Du handler for raskt. Vent litt.',
});

assetRouter.get('/', asyncHandler(getAssets));
assetRouter.get('/katalog', asyncHandler(getCatalog));
assetRouter.post('/kjop', tradeLimiter, asyncHandler(postBuy));
assetRouter.post('/selg', tradeLimiter, asyncHandler(postSell));
