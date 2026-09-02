import type { Response } from 'express';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { createSessionToken } from '../../lib/tokens';

interface SessionContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export async function createSession(playerId: string, context: SessionContext) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      token,
      playerId,
      expiresAt,
      userAgent: context.userAgent?.slice(0, 255) ?? null,
      ip: context.ip?.slice(0, 64) ?? null,
    },
  });

  return { token, expiresAt };
}

/** Looks up a session and its player, deleting it if it has expired. */
export async function resolveSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { player: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return session;
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { token } });
}

export async function destroyAllSessionsForPlayer(playerId: string) {
  await prisma.session.deleteMany({ where: { playerId } });
}

/** Housekeeping: removes sessions that are past their expiry. */
export async function purgeExpiredSessions() {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: env.isProduction ? 'strict' : 'lax',
    secure: env.cookieSecure,
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: env.isProduction ? 'strict' : 'lax',
    secure: env.cookieSecure,
    path: '/',
  });
}
