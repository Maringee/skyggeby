import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import {
  getProfile,
  getTransactions,
  postDeposit,
  postWithdraw,
} from './player.controller';

export const playerRouter = Router();

playerRouter.use(requireAuth);

/**
 * Bank moves take a row lock, so a flood of them from one client serialises and
 * ties up connections. Nothing legitimate needs more than a few per second.
 */
const bankLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'bank',
  message: 'Du sender for mange bankforespørsler. Vent litt.',
});

playerRouter.get('/profil', asyncHandler(getProfile));
playerRouter.get('/transaksjoner', asyncHandler(getTransactions));
playerRouter.post('/bank/innskudd', bankLimiter, asyncHandler(postDeposit));
playerRouter.post('/bank/uttak', bankLimiter, asyncHandler(postWithdraw));
