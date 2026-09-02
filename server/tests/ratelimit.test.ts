/**
 * Rate limiting over real HTTP against the real database.
 *
 * Runs in its own process: the limiter keeps its counters in memory, so a
 * shared process with the concurrency suite would start with dirty buckets.
 */
import { prisma } from '../src/db/prisma';
import {
  atLevel,
  check,
  cleanup,
  createTestPlayer,
  note,
  purgeStaleTestData,
  post,
  reload,
  section,
  startServer,
  summary,
} from './harness';

/** Sends requests one after another so the counter order is deterministic. */
async function sequence<T>(times: number, fn: (index: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < times; i += 1) {
    out.push(await fn(i));
  }
  return out;
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    section('5a. Kriminalitet: 40 forespørsler per minutt');

    {
      const t = await createTestPlayer({ energy: 100, ...atLevel(1) });

      const results = await sequence(50, () =>
        post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie }),
      );

      const ok = results.filter((r) => r.status === 200).length;
      const cooldown = results.filter((r) => r.body?.error?.code === 'AVKJOLING_AKTIV').length;
      const limited = results.filter((r) => r.body?.error?.code === 'FOR_MANGE_FORSOK');

      note(`ok=${ok} avkjøling=${cooldown} rate-limited=${limited.length}`);

      check('rate limit slår inn', limited.length > 0, `${limited.length} blokkert`);
      check('den slår inn etter 40 forespørsler', ok + cooldown === 40, `${ok + cooldown} slapp gjennom`);
      check('status er 429', limited.every((r) => r.status === 429));
      check(
        'meldingen er på norsk',
        limited[0]?.body?.error?.message === 'Du sender for mange forespørsler. Ro ned litt.',
        limited[0]?.body?.error?.message,
      );

      // A blocked request must never reach the game logic.
      const attempts = await prisma.crimeAttempt.count({ where: { playerId: t.player.id } });
      check('blokkerte forespørsler bokfører ingenting', attempts === 1, `${attempts} rader`);

      const after = await reload(t.player.id);
      check('blokkerte forespørsler koster ikke energi', after.energy === 98, `energi=${after.energy}`);
    }

    section('5b. Bank: 30 forespørsler per minutt');

    {
      const t = await createTestPlayer({ cash: 100_000, bankBalance: 0 });

      const results = await sequence(40, () =>
        post(server.base, '/spiller/bank/innskudd', { cookie: t.cookie, body: { amount: 1 } }),
      );

      const ok = results.filter((r) => r.status === 200).length;
      const limited = results.filter((r) => r.body?.error?.code === 'FOR_MANGE_FORSOK');

      note(`ok=${ok} rate-limited=${limited.length}`);

      check('rate limit slår inn', limited.length === 10, `${limited.length} blokkert`);
      check('nøyaktig 30 slapp gjennom', ok === 30, `${ok} ok`);
      check(
        'meldingen er på norsk',
        limited[0]?.body?.error?.message === 'Du sender for mange bankforespørsler. Vent litt.',
        limited[0]?.body?.error?.message,
      );

      const after = await reload(t.player.id);
      check('kun de tillatte innskuddene ble bokført', after.bankBalance === 30, `bank=${after.bankBalance}`);

      const rows = await prisma.transaction.count({ where: { playerId: t.player.id } });
      check('to rader per gjennomsluppet innskudd', rows === 60, `${rows} rader`);
    }

    section('5b2. Inventar: 30 forespørsler per minutt');

    {
      const t = await createTestPlayer();
      // One carryable asset, toggled in and out; the limiter is what we measure.
      const asset = await prisma.asset.create({
        data: {
          playerId: t.player.id,
          assetTypeId: 'lommelykt',
          name: 'Lommelykt',
          category: 'EQUIPMENT',
          purchasePrice: 500,
          currentValue: 500,
          condition: 100,
          maintenanceCostPerDay: 0,
          visibility: 0,
          risk: 0,
          location: 'sentrum',
          status: 'ACTIVE',
        },
      });

      const results = await sequence(40, (i) =>
        post(server.base, i % 2 === 0 ? '/inventar/legg-inn' : '/inventar/ta-ut', {
          cookie: t.cookie,
          body: { assetId: asset.id },
        }),
      );

      const limited = results.filter((r) => r.body?.error?.code === 'FOR_MANGE_FORSOK');
      const throughput = results.length - limited.length;

      note(`slapp gjennom=${throughput} rate-limited=${limited.length}`);

      check('rate limit slår inn', limited.length === 10, `${limited.length} blokkert`);
      check('nøyaktig 30 slapp gjennom', throughput === 30, `${throughput}`);
      check('status er 429', limited.every((r) => r.status === 429));
      check(
        'meldingen er på norsk',
        limited[0]?.body?.error?.message === 'Du endrer inventaret for raskt. Vent litt.',
        limited[0]?.body?.error?.message,
      );

      // Blocked requests never reach the inventory logic.
      const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
      check('sluttilstanden er entydig',
        row.storageLocation === 'INVENTORY' || row.storageLocation === 'STORED',
        row.storageLocation);
    }

    section('5b3. Kontakter: 30 forespørsler per minutt');

    {
      const t = await createTestPlayer();
      await prisma.contactRelationship.create({
        data: { playerId: t.player.id, contactId: 'marius_mekken', trust: 10 },
      });

      const results = await sequence(40, () =>
        post(server.base, '/kontakter/kontakt', {
          cookie: t.cookie,
          body: { contactId: 'marius_mekken' },
        }),
      );

      const limited = results.filter((r) => r.body?.error?.code === 'FOR_MANGE_FORSOK');
      const ok = results.filter((r) => r.status === 200).length;

      note(`ok=${ok} rate-limited=${limited.length}`);

      check('rate limit slår inn', limited.length === 10, `${limited.length} blokkert`);
      check('nøyaktig 30 slapp gjennom', ok === 30, `${ok}`);
      check('status er 429', limited.every((r) => r.status === 429));
      check(
        'meldingen er på norsk',
        limited[0]?.body?.error?.message === 'Du tar kontakt for ofte. Vent litt.',
        limited[0]?.body?.error?.message,
      );

      // Blocked requests never reach the trust logic.
      const row = await prisma.contactRelationship.findFirstOrThrow({
        where: { playerId: t.player.id, contactId: 'marius_mekken' },
      });
      check('kun de tillatte økningene ble registrert', row.trust === 40, `${row.trust}`);
    }

    section('5b4. Virksomheter: 30 forespørsler per minutt');

    {
      // The limiter is shared by the two write endpoints, which is the point:
      // both take row locks and move money, so the quota covers them together.
      const t = await createTestPlayer({ cash: 20_000_000 });

      const results = await sequence(40, (i) =>
        post(server.base, '/virksomheter/kjop', {
          cookie: t.cookie,
          body: { businessTypeId: 'naerbutikk', name: `Butikk ${i}` },
        }),
      );

      const limited = results.filter((r) => r.body?.error?.code === 'FOR_MANGE_FORSOK');
      const created = results.filter((r) => r.status === 201).length;
      const maxed = results.filter((r) => r.body?.error?.code === 'MAKS_VIRKSOMHETER').length;

      note(`opprettet=${created} maksgrense=${maxed} rate-limited=${limited.length}`);

      check('rate limit slår inn', limited.length === 10, `${limited.length} blokkert`);
      check('nøyaktig 30 slapp gjennom', created + maxed === 30, `${created + maxed}`);
      check('status er 429', limited.every((r) => r.status === 429));
      check(
        'meldingen er på norsk',
        limited[0]?.body?.error?.message === 'Du handler for raskt. Vent litt.',
        limited[0]?.body?.error?.message,
      );

      // Blocked requests never reach the game logic: the limit inside the game
      // still holds, and nothing was bought beyond it.
      const owned = await prisma.business.count({ where: { playerId: t.player.id } });
      check('maks tre virksomheter uansett', owned === 3, `${owned}`);

      const uttak = await post(server.base, '/virksomheter/uttak', {
        cookie: t.cookie,
        body: { businessId: 'hva-som-helst' },
      });
      check('uttak deler samme kvote', uttak.status === 429, String(uttak.status));
      check(
        'ingen uttakstransaksjoner ble skrevet',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'VIRKSOMHET_UTTAK' },
        })) === 0,
      );
    }

    section('5c. Innlogging: sperre per konto (10 per 15 min)');

    {
      const results = await sequence(12, () =>
        post(server.base, '/auth/logg-inn', {
          body: { username: 'FinnesIkkeKonto', password: 'feilpassord' },
        }),
      );

      const limited = results.filter((r) => r.body?.error?.code === 'FOR_MANGE_FORSOK');
      const rejected = results.filter((r) => r.status === 401).length;

      note(`avvist=${rejected} rate-limited=${limited.length}`);

      check('sperren slår inn', limited.length > 0, `${limited.length} blokkert`);
      check('ti forsøk slipper gjennom først', rejected === 10, `${rejected} nådde innloggingen`);
      check(
        'meldingen peker på kontoen',
        limited[0]?.body?.error?.message ===
          'For mange innloggingsforsøk på denne kontoen. Vent litt og prøv igjen.',
        limited[0]?.body?.error?.message,
      );
      check(
        'sperren gjelder uansett store og små bokstaver',
        (
          await post(server.base, '/auth/logg-inn', {
            body: { username: 'finnesikkekonto', password: 'x' },
          })
        ).body?.error?.code === 'FOR_MANGE_FORSOK',
      );
    }

    section('5d. Innlogging: sperre per adresse (20 per 15 min)');

    {
      // Unique usernames, so only the address counter can trip.
      const results = await sequence(12, (i) =>
        post(server.base, '/auth/logg-inn', {
          body: { username: `ukjent_${i}_${Date.now()}`, password: 'feilpassord' },
        }),
      );

      const limited = results.filter(
        (r) =>
          r.body?.error?.code === 'FOR_MANGE_FORSOK' &&
          r.body?.error?.message === 'For mange innloggingsforsøk. Vent litt og prøv igjen.',
      );

      note(`adressesperret=${limited.length} av 12`);
      check('adressesperren slår inn', limited.length > 0, `${limited.length} blokkert`);
      check('status er 429', limited.every((r) => r.status === 429));
    }

    section('5e. Registrering: 10 per time');

    {
      const stamp = Date.now().toString(36);
      const results = await sequence(12, (i) =>
        post(server.base, '/auth/registrer', {
          body: {
            // Deliberately invalid, so no accounts are created either way.
            username: `x`,
            password: `passord${stamp}${i}`,
            confirmPassword: `passord${stamp}${i}`,
          },
        }),
      );

      const limited = results.filter((r) => r.body?.error?.code === 'FOR_MANGE_FORSOK');
      note(`rate-limited=${limited.length} av 12`);

      check('registreringssperren slår inn', limited.length === 2, `${limited.length} blokkert`);
      check(
        'meldingen er på norsk',
        limited[0]?.body?.error?.message ===
          'For mange registreringer fra denne maskinen. Prøv igjen senere.',
        limited[0]?.body?.error?.message,
      );
    }

    section('5f. Forfalsket X-Forwarded-For gir ikke ny kvote');

    {
      const results = await sequence(6, (i) =>
        fetch(`${server.base}/auth/logg-inn`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': `203.0.113.${i}`,
          },
          body: JSON.stringify({ username: `spoof_${i}`, password: 'feilpassord' }),
        }).then(async (r) => ({ status: r.status, body: (await r.json()) as any })),
      );

      const limited = results.filter((r) => r.body?.error?.code === 'FOR_MANGE_FORSOK');
      note(`blokkert tross ny adresse hver gang: ${limited.length} av 6`);
      check('adressesperren lar seg ikke omgå', limited.length === 6, `${limited.length} blokkert`);
    }
  } finally {
    await server.close();
    await cleanup();
    await prisma.$disconnect();
  }

  const failed = summary();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
