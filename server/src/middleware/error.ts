import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@skyggeby/shared';
import { AppError } from '../lib/errors';

/**
 * Prisma failures that mean "the database was busy", not "the request was
 * wrong". They surface when many writes for the same player queue behind the
 * row lock, and the player should be told to retry rather than shown a
 * generic server error.
 *
 * P2024 - could not get a connection from the pool
 * P2028 - interactive transaction timed out
 * P2034 - write conflict or deadlock
 */
const BUSY_PRISMA_CODES = new Set(['P2024', 'P2028', 'P2034']);

function prismaCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function notFoundHandler(_req: Request, res: Response) {
  const body: ApiErrorBody = {
    error: { code: 'IKKE_FUNNET', message: 'Endepunktet finnes ikke.' },
  };
  res.status(404).json(body);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof AppError) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    };
    res.status(error.status).json(body);
    return;
  }

  const code = prismaCode(error);

  if (code && BUSY_PRISMA_CODES.has(code)) {
    console.warn(`[SKYGGEBY] Databasen er travel (${code})`);
    const busy: ApiErrorBody = {
      error: {
        code: 'SERVEREN_ER_TRAVEL',
        message: 'Serveren er travel akkurat nå. Prøv igjen om et øyeblikk.',
      },
    };
    res.status(503).json(busy);
    return;
  }

  // Always logged server side - a silent production failure cannot be debugged.
  // Only the generic message below ever reaches the client.
  console.error('[SKYGGEBY] Uventet feil:', error);

  const body: ApiErrorBody = {
    error: {
      code: 'SERVERFEIL',
      message: 'Noe gikk galt på serveren. Prøv igjen om litt.',
    },
  };
  res.status(500).json(body);
}

/** Wraps an async handler so rejected promises reach the error handler. */
export function asyncHandler<T extends (req: Request, res: Response) => Promise<unknown>>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}
