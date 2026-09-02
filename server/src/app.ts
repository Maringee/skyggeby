import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './config/env';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';
import { securityHeaders } from './middleware/security';

export function createApp() {
  const app = express();

  // Only trust forwarding headers when a proxy is actually configured. Left at
  // 0, `req.ip` is the real socket address and cannot be spoofed.
  app.set('trust proxy', env.trustProxy);
  app.disable('x-powered-by');

  app.use(securityHeaders);

  app.use(
    cors({
      origin: env.clientOrigins,
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());

  app.use('/api', apiRouter);

  // Anything under /api that no route matched is a missing endpoint, whether or
  // not this process also serves a frontend.
  app.use('/api', notFoundHandler);

  if (env.serveClient) {
    mountClient(app);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Serves the built frontend from the same process, and therefore the same
 * origin, as the API.
 *
 * That is the whole point of the single-service deployment: the page and
 * `/api` share an origin, so there is no CORS to configure and the session
 * cookie stays first-party. Hashed assets are cached hard; `index.html` never
 * is, or a deploy would leave browsers pointing at files that no longer exist.
 */
function mountClient(app: express.Express) {
  const dir = env.clientDir;
  const indexFile = path.join(dir, 'index.html');

  if (!fs.existsSync(indexFile)) {
    console.warn(
      `[SKYGGEBY] Fant ingen bygget klient i ${dir}. Kjør "npm run build" før produksjonsstart.`,
    );
    return;
  }

  app.use(
    express.static(dir, {
      index: false,
      // Vite hashes every asset filename, so a long cache is safe for them and
      // wrong for the entry document.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // Client-side routing: every non-API path is the single page app. Declared
  // after /api, so an unknown endpoint still answers as JSON rather than HTML.
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
}
