import type { Server } from 'node:http';
import { GAME_NAME } from '@skyggeby/shared';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './db/prisma';
import { purgeExpiredSessions } from './modules/session/session.service';

/** How long a shutdown waits for in-flight requests before giving up. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main() {
  await prisma.$connect();

  const removed = await purgeExpiredSessions();
  if (removed > 0) {
    console.log(`[${GAME_NAME}] Ryddet bort ${removed} utløpte økter.`);
  }

  // Periodic housekeeping so the session table does not grow forever.
  const cleanup = setInterval(
    () => {
      void purgeExpiredSessions().catch((error) => {
        console.error(`[${GAME_NAME}] Klarte ikke å rydde økter:`, error);
      });
    },
    60 * 60 * 1000,
  );
  cleanup.unref?.();

  const app = createApp();

  // Bound to every interface: the platform routes traffic to the container's
  // own address, and loopback would make the service unreachable.
  const server: Server = app.listen(env.port, env.host, () => {
    console.log(`[${GAME_NAME}] Lytter på ${env.host}:${env.port}`);
    console.log(`[${GAME_NAME}] Miljø: ${env.nodeEnv}`);
    console.log(
      `[${GAME_NAME}] Serverer klienten: ${env.serveClient ? 'ja' : 'nei'} · ` +
        `sikker cookie: ${env.cookieSecure ? 'ja' : 'nei'} · ` +
        `proxy-hopp: ${env.trustProxy}`,
    );
    if (env.publicAppUrl) {
      console.log(`[${GAME_NAME}] Offentlig adresse: ${env.publicAppUrl}`);
    }
  });

  /**
   * Graceful shutdown.
   *
   * The platform sends SIGTERM on every deploy and restart. Closing the
   * listener first stops new connections while requests already in flight run
   * to completion, so a deploy cannot cut a database transaction in half. The
   * timeout is the backstop: a stuck connection must not keep the old process
   * alive forever.
   */
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[${GAME_NAME}] Avslutter (${signal}) ...`);
    clearInterval(cleanup);

    const closed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    const timedOut = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), SHUTDOWN_GRACE_MS).unref?.();
    });

    const outcome = await Promise.race([closed.then(() => 'closed' as const), timedOut]);
    if (outcome === 'timeout') {
      console.warn(
        `[${GAME_NAME}] Ventet ${SHUTDOWN_GRACE_MS} ms på aktive forespørsler. Avslutter likevel.`,
      );
    }

    try {
      await prisma.$disconnect();
    } catch (error) {
      console.error(`[${GAME_NAME}] Klarte ikke å lukke databasetilkoblingen:`, error);
    }

    console.log(`[${GAME_NAME}] Avsluttet.`);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Last line of defence: log the reason rather than dying silently.
  process.on('unhandledRejection', (reason) => {
    console.error(`[${GAME_NAME}] Ubehandlet promise-feil:`, reason);
  });
  process.on('uncaughtException', (error) => {
    console.error(`[${GAME_NAME}] Ubehandlet unntak:`, error);
    void shutdown('uncaughtException');
  });
}

main().catch((error) => {
  console.error('[SKYGGEBY] Klarte ikke å starte serveren:', error);
  process.exit(1);
});
