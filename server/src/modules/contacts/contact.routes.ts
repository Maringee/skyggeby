import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import {
  getContactById,
  getContacts,
  postDiscover,
  postInteract,
} from './contact.controller';

export const contactRouter = Router();

contactRouter.use(requireAuth);

/**
 * Nothing here costs money, energy or time, so the limiter exists only to stop
 * a client hammering a locked transaction.
 */
const contactLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'contacts.action',
  message: 'Du tar kontakt for ofte. Vent litt.',
});

contactRouter.get('/', asyncHandler(getContacts));
contactRouter.post('/oppdag', contactLimiter, asyncHandler(postDiscover));
contactRouter.post('/kontakt', contactLimiter, asyncHandler(postInteract));
contactRouter.get('/:contactId', asyncHandler(getContactById));
