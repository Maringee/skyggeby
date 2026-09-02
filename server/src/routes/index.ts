import { Router } from 'express';
import { assetRouter } from '../modules/assets/asset.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { businessRouter } from '../modules/businesses/business.routes';
import { cityRouter } from '../modules/city/city.routes';
import { contactRouter } from '../modules/contacts/contact.routes';
import { crimeRouter } from '../modules/crime/crime.routes';
import { informationRouter } from '../modules/information/information.routes';
import { inventoryRouter } from '../modules/inventory/inventory.routes';
import { messageRouter } from '../modules/messages/message.routes';
import { skillRouter } from '../modules/skills/skill.routes';
import { playerRouter } from '../modules/player/player.routes';
import { profileRouter } from '../modules/players/profile.routes';
import { propertyRouter } from '../modules/properties/property.routes';
import { vehicleRouter } from '../modules/vehicles/vehicle.routes';

export const apiRouter = Router();

/**
 * Liveness check.
 *
 * Deliberately trivial: no session, no database query, no secrets. The platform
 * polls this constantly, and a health check that touches Postgres would take
 * the site down every time the database blinked.
 *
 * `/api/helse` is the original Norwegian name and stays; `/api/health` is what
 * the platform's health check is pointed at.
 */
function health(_req: import('express').Request, res: import('express').Response) {
  res.json({ status: 'ok', tid: new Date().toISOString() });
}

apiRouter.get('/health', health);
apiRouter.get('/helse', health);

apiRouter.use('/auth', authRouter);
apiRouter.use('/spiller', playerRouter);
apiRouter.use('/kriminalitet', crimeRouter);
apiRouter.use('/by', cityRouter);
apiRouter.use('/informasjon', informationRouter);
apiRouter.use('/ferdigheter', skillRouter);
apiRouter.use('/eiendeler', assetRouter);
apiRouter.use('/inventar', inventoryRouter);
apiRouter.use('/kontakter', contactRouter);
apiRouter.use('/virksomheter', businessRouter);
apiRouter.use('/meldinger', messageRouter);
apiRouter.use('/spillere', profileRouter);
apiRouter.use('/kjoretoy', vehicleRouter);
apiRouter.use('/eiendom', propertyRouter);
