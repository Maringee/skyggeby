import type { NextFunction, Request, Response } from 'express';

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

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
}
