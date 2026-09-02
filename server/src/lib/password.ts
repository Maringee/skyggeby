import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A real bcrypt hash of a value nobody knows, at the same cost factor as live
 * passwords. Verifying against it burns the same CPU time as a genuine check,
 * which is what makes the "unknown username" path indistinguishable from the
 * "wrong password" path.
 *
 * It must be a well-formed hash: a malformed one is rejected instantly by
 * bcrypt and leaks the difference through response timing.
 */
export const DUMMY_PASSWORD_HASH =
  '$2a$12$E1D0tckfNpJcKhYQhvBAUer4H9QcIUCcz08Caqa1e93RWXLtIqe1e';
