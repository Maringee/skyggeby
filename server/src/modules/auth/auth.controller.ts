import type { Request, Response } from 'express';
import type { AuthResponse, MeResponse } from '@skyggeby/shared';
import { toPlayerDto } from '../../lib/serialize';
import { loginSchema, parseOrThrow, registerSchema } from '../../lib/validation';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  setSessionCookie,
} from '../session/session.service';
import { syncVitals } from '../player/progression.service';
import { authenticate, registerPlayer } from './auth.service';

function requestContext(req: Request) {
  return {
    userAgent: req.get('user-agent') ?? undefined,
    ip: req.ip ?? undefined,
  };
}

export async function register(req: Request, res: Response) {
  const input = parseOrThrow(registerSchema, req.body);
  const player = await registerPlayer(input.username, input.password);

  const { token, expiresAt } = await createSession(player.id, requestContext(req));
  setSessionCookie(res, token, expiresAt);

  const body: AuthResponse = { player: toPlayerDto(player) };
  res.status(201).json(body);
}

export async function login(req: Request, res: Response) {
  const input = parseOrThrow(loginSchema, req.body);
  const player = await authenticate(input.username, input.password);

  const { token, expiresAt } = await createSession(player.id, requestContext(req));
  setSessionCookie(res, token, expiresAt);

  const body: AuthResponse = { player: toPlayerDto(player) };
  res.status(200).json(body);
}

export async function logout(req: Request, res: Response) {
  if (req.sessionToken) {
    await destroySession(req.sessionToken);
  }
  clearSessionCookie(res);
  res.status(200).json({ message: 'Du er logget ut.' });
}

export async function me(req: Request, res: Response) {
  const player = await syncVitals(req.player!.id);
  const body: MeResponse = { player: toPlayerDto(player) };
  res.status(200).json(body);
}
