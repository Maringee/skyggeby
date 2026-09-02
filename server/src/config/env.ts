import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Mangler miljøvariabel: ${name}. Kopier server/.env.example til server/.env og fyll ut.`,
    );
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),
  /**
   * Interface to bind. Railway routes traffic to the container's own address,
   * so binding to loopback would make the service unreachable there.
   */
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: required('DATABASE_URL'),
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /**
   * How many reverse proxies sit in front of the API.
   *
   * Must stay 0 unless a proxy really does rewrite `X-Forwarded-For`. With a
   * non-zero value and no such proxy, any client can spoof the header and give
   * itself a fresh rate-limit bucket on every request.
   */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  /**
   * Whether this process also serves the built frontend.
   *
   * On by default in production, which is what makes the single-service
   * deployment work: one origin for the page and the API, and therefore no
   * CORS and a first-party session cookie. Set SERVE_CLIENT=false to run the
   * API alone.
   */
  serveClient: process.env.SERVE_CLIENT
    ? process.env.SERVE_CLIENT === 'true'
    : process.env.NODE_ENV === 'production',
  /** Where the built frontend lives, relative to the compiled server. */
  clientDir: process.env.CLIENT_DIR ?? path.resolve(__dirname, '../../../client/dist'),
  /** Public address of the deployment. Logged at startup; never required. */
  publicAppUrl: process.env.PUBLIC_APP_URL ?? '',
} as const;

function parseTrustProxy(raw: string | undefined): number {
  if (!raw) return 0;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0) return 0;
  return hops;
}
