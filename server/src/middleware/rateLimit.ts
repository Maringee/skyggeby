import type { NextFunction, Request, Response } from 'express';
import { tooManyRequests } from '../lib/errors';

interface Bucket {
  count: number;
  resetAt: number;
}

/** Upper bound on tracked keys, so a spray of unique keys cannot eat memory. */
const MAX_TRACKED_KEYS = 20_000;

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Norwegian message shown when the limit is hit. */
  message: string;
  keyPrefix: string;
  /**
   * Replaces the client address as the bucket dimension, e.g. the username
   * being logged into. Deliberately *replaces* rather than extends it: a
   * per-account limit keyed on address too would give every attacking machine
   * its own bucket, which is exactly what it is meant to prevent.
   *
   * Returning null skips this limiter for the request.
   */
  key?: (req: Request) => string | null;
}

/**
 * Small in-memory rate limiter. Good enough to blunt brute-force attempts on a
 * single-node deployment; swap for a shared store when we scale horizontally.
 *
 * The address comes from `req.ip`, which is only derived from forwarding
 * headers when `TRUST_PROXY` is configured - otherwise it is the real socket
 * address and a client cannot rotate it to get a fresh bucket.
 */
export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, options.windowMs);
  sweep.unref?.();

  return (req: Request, _res: Response, next: NextFunction) => {
    let dimension: string;

    if (options.key) {
      const resolved = options.key(req);
      // Nothing to key on: let the other limiters and validation handle it.
      if (resolved === null) return next();
      dimension = resolved;
    } else {
      dimension = req.ip ?? 'ukjent';
    }

    const key = `${options.keyPrefix}:${dimension}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= MAX_TRACKED_KEYS) {
        // Drop the oldest entry rather than growing without bound. Map keeps
        // insertion order, so the first key is the least recently created.
        const oldest = buckets.keys().next();
        if (!oldest.done) buckets.delete(oldest.value);
      }
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      next(tooManyRequests(options.message));
      return;
    }

    next();
  };
}

/**
 * Applies several limiters in order. Used where one dimension alone is not
 * enough, such as login: per address stops one machine hammering the endpoint,
 * per account stops a botnet hammering one player's password.
 */
export function combineLimiters(
  ...limiters: Array<(req: Request, res: Response, next: NextFunction) => void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    let index = 0;

    const run = (error?: unknown): void => {
      if (error) return next(error);
      const limiter = limiters[index];
      index += 1;
      if (!limiter) return next();
      limiter(req, res, run);
    };

    run();
  };
}
