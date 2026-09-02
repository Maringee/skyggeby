import type { Request } from 'express';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import {
  getCatalog,
  getVehicleById,
  getVehicles,
  postActivate,
  postBuy,
  postMove,
  postPark,
  postSell,
} from './vehicle.controller';

export const vehicleRouter = Router();

vehicleRouter.use(requireAuth);

/** Keyed on the account, so one player cannot spend another player's quota. */
const byPlayer = (req: Request) => req.player?.id ?? null;

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: 'vehicles.read',
  key: byPlayer,
  message: 'Du henter kjøretøy for raskt. Vent litt.',
});

/**
 * Buying moves money and takes a row lock, so it gets the same tight quota the
 * other purchase endpoints use.
 */
const buyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'vehicles.buy',
  key: byPlayer,
  message: 'Du kjøper for raskt. Vent litt.',
});

/**
 * Driving, parking and selling share one quota. They are the same kind of act -
 * a locked write against your own garage - and splitting the budget would only
 * make it easier to keep the locks busy.
 */
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'vehicles.action',
  key: byPlayer,
  message: 'Du gjør for mye på én gang. Vent litt.',
});

vehicleRouter.get('/', readLimiter, asyncHandler(getVehicles));
// Declared before the parameterised route, or "katalog" would be read as an id.
vehicleRouter.get('/katalog', readLimiter, asyncHandler(getCatalog));
vehicleRouter.post('/kjop', buyLimiter, asyncHandler(postBuy));
vehicleRouter.post('/aktiver', actionLimiter, asyncHandler(postActivate));
vehicleRouter.post('/park', actionLimiter, asyncHandler(postPark));
vehicleRouter.post('/flytt', actionLimiter, asyncHandler(postMove));
vehicleRouter.post('/selg', actionLimiter, asyncHandler(postSell));
vehicleRouter.get('/:vehicleId', readLimiter, asyncHandler(getVehicleById));
