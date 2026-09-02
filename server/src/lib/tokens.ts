import crypto from 'node:crypto';

/** Cryptographically strong, URL-safe opaque session token. */
export function createSessionToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}
