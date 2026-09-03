import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

/**
 * Baseline security headers.
 *
 * Written out rather than pulled from a package: this is the whole set the app
 * actually needs, and each line below is here because something in the built
 * frontend depends on it being exactly this.
 *
 * The content policy is derived from what `client/dist/index.html` really
 * loads:
 *  - `script-src 'self'`      the entry bundle is an external, hashed module;
 *                             there is no inline script in the built document.
 *  - `style-src` allows inline styles and Google Fonts. Inline is required
 *    because the interface positions elements with `style={{ ... }}`
 *    attributes, which CSP counts as inline styles; the font host is required
 *    because `styles/index.css` starts with an @import from Google Fonts.
 *  - `font-src` allows the file host those stylesheets point at.
 *  - `connect-src 'self'`     the API is same-origin. A split deployment would
 *    have to widen this, which is one more reason to keep them together.
 *  - `frame-ancestors 'none'` nothing may embed the game.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

/**
 * One year, subdomains included. No `preload`: that submits the domain to a
 * list baked into browsers and is effectively irreversible, which is not a
 * commitment a staging host on a shared `up.railway.app` domain should make.
 */
const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

/**
 * Whether this response travels over HTTPS.
 *
 * `req.secure` is the accurate answer: behind Railway's proxy it reads
 * `X-Forwarded-Proto`, which Express only trusts because `trust proxy` is set
 * from `TRUST_PROXY`. `cookieSecure` is the belt to that suspenders - it is the
 * operator saying "this deployment is HTTPS", so a misconfigured hop count
 * cannot silently drop the header.
 */
function isHttps(req: Request): boolean {
  return req.secure || env.cookieSecure;
}

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Only ever sent over HTTPS. Browsers ignore HSTS from a plain-http response
  // anyway, and emitting it in local development is a good way to pin someone's
  // localhost to a scheme their dev server does not speak.
  if (isHttps(req)) {
    res.setHeader('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY);
  }

  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
}
