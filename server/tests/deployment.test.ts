/**
 * Deployment tests: the things a hosted instance depends on that no gameplay
 * test would ever notice.
 *
 * Nothing here touches game state. It checks the contract the platform and the
 * browser rely on - the health check, the security headers, that failures stay
 * generic, and that the proxy and client-serving switches read their
 * environment the way the deployment assumes.
 *
 * Run with `npm -w @skyggeby/server run test:deployment`.
 */
import type { NextFunction, Request, Response } from 'express';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { securityHeaders } from '../src/middleware/security';
import {
  check,
  cleanup,
  createTestPlayer,
  get,
  note,
  post,
  purgeStaleTestData,
  section,
  startServer,
  summary,
} from './harness';

/**
 * Runs the security middleware against a stand-in request and collects the
 * headers it set.
 *
 * The HTTPS branch cannot be reached over the plain-http test server, and the
 * environment is read once at import - so the branch is exercised where it
 * actually lives rather than by starting a second process with a TLS
 * certificate.
 */
function headersFor(secure: boolean): Record<string, string> {
  const set: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      set[name] = value;
    },
  } as unknown as Response;

  let calledNext = false;
  securityHeaders({ secure } as Request, res, (() => {
    calledNext = true;
  }) as NextFunction);

  if (!calledNext) throw new Error('securityHeaders kalte ikke next()');
  return set;
}

/** Raw fetch, so headers can be inspected rather than just the body. */
async function raw(base: string, path: string, cookie?: string) {
  const res = await fetch(`${base}${path}`, {
    headers: cookie ? { cookie } : {},
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1. Helsesjekk');

    {
      const res = await raw(server.base, '/health');
      check('helsesjekken svarer 200', res.status === 200, String(res.status));

      const body = JSON.parse(res.text) as Record<string, unknown>;
      check('statusen er ok', body.status === 'ok', String(body.status));
      check(
        'svaret er lite og uten hemmeligheter',
        res.text.length < 100 &&
          !/passord|secret|token|DATABASE_URL|postgres/i.test(res.text),
        res.text,
      );

      // The platform polls this constantly; a database round trip here would
      // take the site down every time Postgres blinked.
      check(
        'den krever ingen innlogging',
        res.status === 200 && !res.headers.has('set-cookie'),
      );

      const norwegian = await raw(server.base, '/helse');
      check('det norske navnet svarer fortsatt', norwegian.status === 200);
      check(
        'begge gir samme status',
        JSON.parse(norwegian.text).status === 'ok',
      );

      const started = Date.now();
      await raw(server.base, '/health');
      const elapsed = Date.now() - started;
      note(`helsesjekken tok ${elapsed} ms`);
      check('den er rask', elapsed < 500, `${elapsed} ms`);
    }

    /* ================================================================== */
    section('2. Sikkerhetsheadere');

    {
      const res = await raw(server.base, '/health');

      const expected: Array<[string, string]> = [
        ['x-content-type-options', 'nosniff'],
        ['x-frame-options', 'DENY'],
        ['referrer-policy', 'no-referrer'],
        ['cross-origin-opener-policy', 'same-origin'],
      ];

      for (const [header, value] of expected) {
        check(
          `${header} er satt`,
          res.headers.get(header) === value,
          res.headers.get(header) ?? 'mangler',
        );
      }

      // HSTS belongs on HTTPS only. This suite runs over plain http, so the
      // header must be absent here - a browser would ignore it anyway, and
      // emitting it in development risks pinning localhost to a scheme the dev
      // server does not speak.
      check(
        'HSTS sendes ikke over vanlig http',
        res.headers.get('strict-transport-security') === null,
        res.headers.get('strict-transport-security') ?? 'mangler',
      );

      const overHttps = headersFor(true);
      const hsts = overHttps['Strict-Transport-Security'] ?? '';
      check('HSTS settes over HTTPS', hsts.length > 0, hsts || 'mangler');
      check('den varer i ett år', hsts.includes('max-age=31536000'), hsts);
      check('den dekker underdomener', hsts.includes('includeSubDomains'), hsts);
      check(
        'den ber ikke om preload',
        !hsts.includes('preload'),
        hsts,
      );

      const overHttp = headersFor(false);
      check(
        'og ingen HSTS uten HTTPS',
        overHttp['Strict-Transport-Security'] === undefined,
        overHttp['Strict-Transport-Security'] ?? 'mangler',
      );

      // The rest of the set must be identical on both sides: HSTS is the only
      // header that depends on the transport.
      const withoutHsts = (headers: Record<string, string>) => {
        const copy = { ...headers };
        delete copy['Strict-Transport-Security'];
        return JSON.stringify(copy);
      };
      check(
        'ingen andre headere endret seg av HTTPS',
        withoutHsts(overHttps) === withoutHsts(overHttp),
      );

      const csp = res.headers.get('content-security-policy') ?? '';
      check('innholdspolicy er satt', csp.length > 0);
      check("script-src er 'self'", csp.includes("script-src 'self'"), csp);
      check('ingenting kan ramme inn spillet', csp.includes("frame-ancestors 'none'"));
      check('objekter er blokkert', csp.includes("object-src 'none'"));
      check(
        'API-kall går kun til samme origin',
        csp.includes("connect-src 'self'"),
        csp,
      );
      check(
        'skriftene som faktisk brukes er tillatt',
        csp.includes('fonts.googleapis.com') && csp.includes('fonts.gstatic.com'),
      );

      check('serveren røper ikke rammeverket', res.headers.get('x-powered-by') === null);
    }

    /* ================================================================== */
    section('3. Feil lekker ingenting');

    {
      const missing = await raw(server.base, '/finnes-ikke');
      check('ukjent endepunkt gir 404', missing.status === 404, String(missing.status));
      check(
        'svaret er JSON, ikke HTML',
        missing.headers.get('content-type')?.includes('application/json') === true,
        missing.headers.get('content-type') ?? '',
      );
      check(
        'ingen stacktrace i svaret',
        !/at .*\(|node_modules|\.ts:\d+|Error:/.test(missing.text),
        missing.text,
      );

      // A validation failure is the closest thing to a server error a test can
      // trigger on demand; it must also stay generic.
      const t = await createTestPlayer({ cash: 100 });
      const bad = await post(server.base, '/eiendom/kjop', {
        cookie: t.cookie,
        body: { propertyTypeId: 'finnes-ikke', name: 'x' },
      });
      check('ugyldig forespørsel gir 400', bad.status === 400, String(bad.status));
      check(
        'feilen er norsk og generisk',
        typeof bad.body?.error?.message === 'string' &&
          !JSON.stringify(bad.body).includes('prisma') &&
          !JSON.stringify(bad.body).includes('at '),
        JSON.stringify(bad.body),
      );

      const unauth = await get(server.base, '/spiller/profil');
      check('uten økt er svaret 401', unauth.status === 401, String(unauth.status));
      check(
        'og det sier ingenting om hvorfor internt',
        unauth.body?.error?.code === 'IKKE_AUTENTISERT',
        unauth.body?.error?.code,
      );
    }

    /* ================================================================== */
    section('4. Miljøkonfigurasjon');

    {
      check('serveren binder seg til alle grensesnitt', env.host === '0.0.0.0', env.host);
      check('porten er et tall', Number.isInteger(env.port), `${env.port}`);
      check('databasen kommer fra miljøet', env.databaseUrl.length > 0);
      check(
        'tilkoblingsstrengen er ikke hardkodet i koden',
        env.databaseUrl === process.env.DATABASE_URL,
      );

      // The default has to be 0: with a hop count and no proxy in front, any
      // client could forge X-Forwarded-For and hand itself a fresh rate-limit
      // bucket on every request.
      check(
        'proxy-tillit er 0 når ingenting er satt',
        env.trustProxy === (process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 0),
        `${env.trustProxy}`,
      );

      check(
        'klienten serveres kun når det er bedt om det',
        env.serveClient === (process.env.SERVE_CLIENT === 'true' || env.isProduction),
        `${env.serveClient}`,
      );
      check(
        'sikker cookie er av utenfor HTTPS',
        env.cookieSecure === (process.env.COOKIE_SECURE === 'true'),
      );
      check(
        'lokalt utviklingsorigin finnes som standard',
        env.clientOrigins.length > 0,
        env.clientOrigins.join(','),
      );
    }

    /* ================================================================== */
    section('5. Databasen svarer');

    {
      // Not part of the health check on purpose - this is the deploy-time
      // question ("did migrations run?"), not the every-few-seconds one.
      const started = Date.now();
      const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
      note(`databasen svarte på ${Date.now() - started} ms`);
      check('databasen svarer', rows.length === 1);

      const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
      `;
      const names = new Set(tables.map((row) => row.table_name));

      for (const table of [
        'players',
        'sessions',
        'transactions',
        'assets',
        'vehicles',
        'businesses',
        'properties',
        'messages',
        'contact_relationships',
        'information',
        'player_skills',
        'crime_attempts',
      ]) {
        check(`tabellen ${table} finnes`, names.has(table));
      }

      check(
        'migrasjonstabellen finnes',
        names.has('_prisma_migrations'),
        [...names].join(','),
      );

      const applied = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `;
      note(`${applied[0]?.count} migrasjoner er anvendt`);
      check('migrasjoner er anvendt', Number(applied[0]?.count ?? 0) > 0);
    }
  } finally {
    await cleanup();
    await server.close();
    await prisma.$disconnect();
  }

  const failed = summary();
  process.exit(failed === 0 ? 0 : 1);
}

void main();
