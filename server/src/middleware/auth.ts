import type { NextFunction, Request, Response } from 'express';
import type { Player } from '@prisma/client';
import { SESSION_COOKIE_NAME } from '@skyggeby/shared';
import { unauthorized } from '../lib/errors';
import { touchPresence } from '../modules/player/presence.service';
import { clearSessionCookie, resolveSession } from '../modules/session/session.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      player?: Player;
      sessionToken?: string;
    }
  }
}

/**
 * Requires a valid session cookie. Everything behind this middleware can rely on
 * `req.player` being a freshly loaded, server-owned player record.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (!token) {
      throw unauthorized('Du må logge inn for å fortsette.');
    }

    const session = await resolveSession(token);
    if (!session) {
      clearSessionCookie(res);
      throw unauthorized('Økten er utløpt. Logg inn på nytt.');
    }

    req.player = session.player;
    req.sessionToken = token;

    // Throttled, fire-and-forget; must never block the request.
    touchPresence(session.playerId);

    next();
  } catch (error) {
    next(error);
  }
}
