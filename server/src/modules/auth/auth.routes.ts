import { Router } from 'express';
import { asyncHandler } from '../../middleware/error';
import { requireAuth } from '../../middleware/auth';
import { combineLimiters, rateLimit } from '../../middleware/rateLimit';
import { login, logout, me, register } from './auth.controller';

export const authRouter = Router();

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyPrefix: 'register',
  message: 'For mange registreringer fra denne maskinen. Prøv igjen senere.',
});

/** Stops one machine hammering the login endpoint. */
const loginByAddress = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: 'login.addr',
  message: 'For mange innloggingsforsøk. Vent litt og prøv igjen.',
});

/**
 * Stops many machines hammering one account. Address limiting alone does
 * nothing against credential stuffing spread over a botnet.
 */
const loginByAccount = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'login.user',
  message: 'For mange innloggingsforsøk på denne kontoen. Vent litt og prøv igjen.',
  key: (req) => {
    const username = (req.body as { username?: unknown } | undefined)?.username;
    return typeof username === 'string' ? username.trim().toLowerCase().slice(0, 64) : null;
  },
});

authRouter.post('/registrer', registerLimiter, asyncHandler(register));
authRouter.post(
  '/logg-inn',
  combineLimiters(loginByAddress, loginByAccount),
  asyncHandler(login),
);
authRouter.post('/logg-ut', requireAuth, asyncHandler(logout));
authRouter.get('/meg', requireAuth, asyncHandler(me));
