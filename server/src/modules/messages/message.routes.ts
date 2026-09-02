import type { Request } from 'express';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import {
  getMessageById,
  getMessages,
  getRecipients,
  getUnread,
  postDelete,
  postRead,
  postSend,
} from './message.controller';

export const messageRouter = Router();

messageRouter.use(requireAuth);

/**
 * Messaging limits are per account rather than per address.
 *
 * Everything here is behind `requireAuth`, so the session is the honest
 * dimension: two players sharing a household connection should not share a
 * quota, and one player should not get a fresh one by changing network.
 */
const byPlayer = (req: Request) => req.player?.id ?? null;

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'messages.send',
  key: byPlayer,
  message: 'Du sender meldinger for raskt. Vent litt.',
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyPrefix: 'messages.read',
  key: byPlayer,
  message: 'Du henter meldinger for raskt. Vent litt.',
});

const markLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyPrefix: 'messages.mark',
  key: byPlayer,
  message: 'Du markerer meldinger for raskt. Vent litt.',
});

const deleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'messages.delete',
  key: byPlayer,
  message: 'Du sletter meldinger for raskt. Vent litt.',
});

messageRouter.get('/', readLimiter, asyncHandler(getMessages));
// Both declared before the parameterised route, or they would be read as ids.
messageRouter.get('/uleste', readLimiter, asyncHandler(getUnread));
messageRouter.get('/mottakere', readLimiter, asyncHandler(getRecipients));
messageRouter.post('/send', sendLimiter, asyncHandler(postSend));
messageRouter.get('/:messageId', readLimiter, asyncHandler(getMessageById));
messageRouter.post('/:messageId/les', markLimiter, asyncHandler(postRead));
messageRouter.post('/:messageId/slett', deleteLimiter, asyncHandler(postDelete));
