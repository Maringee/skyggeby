import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error';
import { rateLimit } from '../../middleware/rateLimit';
import { getSkills, postUpgrade } from './skill.controller';

export const skillRouter = Router();

skillRouter.use(requireAuth);

/**
 * Skill points are the real limit on upgrading, but the endpoint still takes a
 * row lock per call. This keeps a client from hammering a transaction it
 * cannot win.
 */
const upgradeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'skills.upgrade',
  message: 'Du oppgraderer for raskt. Vent litt.',
});

skillRouter.get('/', asyncHandler(getSkills));
skillRouter.post('/oppgrader', upgradeLimiter, asyncHandler(postUpgrade));
