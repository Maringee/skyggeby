/**
 * Integration tests for the business system, against the real PostgreSQL
 * database and a real Express server.
 *
 * Nothing here is mocked. The concurrency and rollback sections exist to prove
 * that the row locks, the conditional claim and the database CHECK constraints
 * behave under genuine parallel load.
 *
 * Run with `npm -w @skyggeby/server run test:businesses`.
 *
 * Rate limiting for the two write endpoints lives in `ratelimit.test.ts`, which
 * runs in its own process: the limiter keeps its counters in memory, so
 * measuring them from a suite that has already spent the bucket would be
 * meaningless.
 */
import {
  BUSINESS_TUNING,
  BUSINESS_TYPES,
  MAX_SETTLEMENT_DAYS,
  calculateBusinessSettlement,
  calculateBusinessValue,
  findBusinessType,
  netIncomePerDay,
  validateBusinessCatalogue,
} from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/errors';
import {
  buyBusiness,
  getBusiness,
  listBusinesses,
  withdrawFromBusiness,
} from '../src/modules/businesses/business.service';
import {
  burst,
  check,
  cleanup,
  createTestPlayer,
  get,
  note,
  post,
  purgeStaleTestData,
  reload,
  section,
  startServer,
  summary,
} from './harness';

const DAY_MS = 24 * 60 * 60 * 1000;

async function settle<T>(fn: () => Promise<T>) {
  try {
    return { ok: true, value: await fn(), code: undefined as string | undefined };
  } catch (error) {
    return {
      ok: false,
      value: undefined as T | undefined,
      code: error instanceof AppError ? error.code : `UVENTET:${String(error)}`,
    };
  }
}

async function businessesOf(playerId: string) {
  return prisma.business.findMany({ where: { playerId }, orderBy: { purchasedAt: 'asc' } });
}

/** Rewinds a business's clock so elapsed time can be tested without waiting. */
async function rewind(businessId: string, ms: number) {
  await prisma.business.update({
    where: { id: businessId },
    data: { lastSettlementAt: new Date(Date.now() - ms) },
  });
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1-8. Katalogen');

    {
      check('katalogen har 6 virksomheter', BUSINESS_TYPES.length === 6, `${BUSINESS_TYPES.length}`);

      const ids = BUSINESS_TYPES.map((b) => b.id);
      check('alle id-er er unike', new Set(ids).size === ids.length);

      const names = BUSINESS_TYPES.map((b) => b.name);
      check('alle navn er unike', new Set(names).size === names.length);

      const districts = new Set(BUSINESS_TYPES.map((b) => b.districtId));
      check(
        'alle distrikt-id-er finnes i bykatalogen',
        BUSINESS_TYPES.every((b) => findBusinessType(b.id)?.districtId === b.districtId),
      );
      check('seks ulike distrikter', districts.size === 6, `${districts.size}`);

      check(
        'alle priser er positive heltall',
        BUSINESS_TYPES.every((b) => Number.isInteger(b.purchasePrice) && b.purchasePrice > 0),
      );
      check(
        'inntekt og driftskostnad er gyldige',
        BUSINESS_TYPES.every(
          (b) =>
            b.incomePerDay >= 0 &&
            b.operatingCostPerDay >= 0 &&
            b.incomePerDay >= b.operatingCostPerDay,
        ),
      );
      check(
        'risiko 1-5, aktivitet og tilstand 0-100',
        BUSINESS_TYPES.every(
          (b) =>
            b.risk >= 1 &&
            b.risk <= 5 &&
            b.activity >= 0 &&
            b.activity <= 100 &&
            b.condition >= 0 &&
            b.condition <= 100,
        ),
      );

      const problems = validateBusinessCatalogue();
      check('katalogvalideringen finner ingen feil', problems.length === 0, problems.join('; '));

      // The v1 balance, spelled out. These are the numbers the design named.
      const expectedNet: Record<string, number> = {
        naerbutikk: 1250,
        verksted: 2000,
        drosjesentral: 2750,
        nattklubb: 5000,
        lagerfirma: 5000,
        konsulentselskap: 8000,
      };
      check(
        'nettoratene stemmer med v1-balansen',
        BUSINESS_TYPES.every((b) => netIncomePerDay(b) === expectedNet[b.id]),
        BUSINESS_TYPES.map((b) => `${b.id}=${netIncomePerDay(b)}`).join(','),
      );

      const nattklubb = findBusinessType('nattklubb');
      check('nattklubb koster 750 000', nattklubb?.purchasePrice === 750000);
      check('nattklubb ligger i neon', nattklubb?.districtId === 'neon');
      check('nattklubb har risiko 3', nattklubb?.risk === 3);
      check('ukjent virksomhetstype gir undefined', findBusinessType('finnes-ikke') === undefined);
    }

    /* ================================================================== */
    section('9-18. Kjøp');

    {
      const t = await createTestPlayer({ cash: 500000 });
      // The player stands somewhere else entirely: the district must come from
      // the catalogue, not from where they happen to be.
      await prisma.player.update({
        where: { id: t.player.id },
        data: { currentDistrictId: 'blokkene' },
      });

      const before = Date.now();
      const res = await post(server.base, '/virksomheter/kjop', {
        cookie: t.cookie,
        body: { businessTypeId: 'verksted', name: '  Rømmas Verksted  ' },
      });

      check('kjøp svarer 201', res.status === 201, String(res.status));
      check(
        'meldingen er norsk',
        /Du kjøpte verksted for/.test(res.body?.message ?? ''),
        res.body?.message,
      );

      const after = await reload(t.player.id);
      check('serverprisen ble trukket', after.cash === 500000 - 350000, `cash=${after.cash}`);

      const rows = await businessesOf(t.player.id);
      check('virksomheten ble opprettet', rows.length === 1, `${rows.length}`);

      const row = rows[0]!;
      check('navnet ble trimmet', row.name === 'Rømmas Verksted', `"${row.name}"`);
      check('distriktet er katalogens', row.districtId === 'havna', row.districtId);
      check('tilstand starter på 100', row.condition === 100, `${row.condition}`);
      check('aktivitet er katalogens', row.activity === 55, `${row.activity}`);
      check('risiko er katalogens', row.risk === 2, `${row.risk}`);
      check('driftskontoen starter på 0', row.cashBalance === 0, `${row.cashBalance}`);
      check(
        'oppgjørstidspunktet settes ved kjøp',
        row.lastSettlementAt.getTime() >= before &&
          row.lastSettlementAt.getTime() === row.purchasedAt.getTime(),
        `${row.lastSettlementAt.toISOString()} vs ${row.purchasedAt.toISOString()}`,
      );

      const purchases = await prisma.transaction.findMany({
        where: { playerId: t.player.id, type: 'VIRKSOMHET_KJOP' },
      });
      check('kjøpet ble bokført', purchases.length === 1, `${purchases.length}`);
      check('beløpet er negativt og korrekt', purchases[0]?.amount === -350000, `${purchases[0]?.amount}`);
      check('saldoen etter er bokført', purchases[0]?.balanceAfter === 150000, `${purchases[0]?.balanceAfter}`);
    }

    /* ================================================================== */
    section('19. Uten nok penger, og maks tre virksomheter');

    {
      const poor = await createTestPlayer({ cash: 199999 });
      const denied = await settle(() => buyBusiness(poor.player.id, 'naerbutikk', 'For dyrt'));
      check('kjøp uten nok kontanter avvises', !denied.ok, 'lyktes uventet');
      check('feilkoden er midler', denied.code === 'IKKE_NOK_MIDLER', denied.code);
      check('ingen virksomhet ble opprettet', (await businessesOf(poor.player.id)).length === 0);
      check(
        'ingen transaksjon ble skrevet',
        (await prisma.transaction.count({ where: { playerId: poor.player.id } })) === 0,
      );

      const rich = await createTestPlayer({ cash: 5000000 });
      await buyBusiness(rich.player.id, 'naerbutikk', 'Butikk 1');
      await buyBusiness(rich.player.id, 'verksted', 'Verksted 2');
      await buyBusiness(rich.player.id, 'drosjesentral', 'Sentral 3');

      const cashBefore = (await reload(rich.player.id)).cash;
      const fourth = await settle(() => buyBusiness(rich.player.id, 'nattklubb', 'Klubb 4'));

      check('den fjerde virksomheten avvises', !fourth.ok, 'lyktes uventet');
      check('feilkoden er maksgrensen', fourth.code === 'MAKS_VIRKSOMHETER', fourth.code);
      check('spilleren har fortsatt tre', (await businessesOf(rich.player.id)).length === 3);
      check('ingenting ble trukket', (await reload(rich.player.id)).cash === cashBefore);
    }

    /* ================================================================== */
    section('20-21. Navn og ekstra felter');

    {
      const t = await createTestPlayer({ cash: 3000000 });

      const short = await post(server.base, '/virksomheter/kjop', {
        cookie: t.cookie,
        body: { businessTypeId: 'naerbutikk', name: 'ab' },
      });
      check('for kort navn avvises', short.status === 400, String(short.status));
      check(
        'feilmeldingen er norsk',
        /minst 3 tegn/.test(short.body?.error?.message ?? ''),
        short.body?.error?.message,
      );

      const long = await post(server.base, '/virksomheter/kjop', {
        cookie: t.cookie,
        body: { businessTypeId: 'naerbutikk', name: 'x'.repeat(33) },
      });
      check('for langt navn avvises', long.status === 400, String(long.status));

      const blank = await post(server.base, '/virksomheter/kjop', {
        cookie: t.cookie,
        body: { businessTypeId: 'naerbutikk', name: '     ' },
      });
      check('navn med bare mellomrom avvises', blank.status === 400, String(blank.status));

      check(
        'ingen virksomhet ble opprettet av ugyldige navn',
        (await businessesOf(t.player.id)).length === 0,
      );
      check(
        'ingen penger ble trukket av ugyldige navn',
        (await reload(t.player.id)).cash === 3000000,
      );

      const ok = await post(server.base, '/virksomheter/kjop', {
        cookie: t.cookie,
        body: { businessTypeId: 'naerbutikk', name: 'Hjørnet   på    Blokka' },
      });
      check('gyldig navn godtas', ok.status === 201, String(ok.status));
      check(
        'mellomrom normaliseres',
        (await businessesOf(t.player.id))[0]?.name === 'Hjørnet på Blokka',
        (await businessesOf(t.player.id))[0]?.name,
      );
    }

    /* ================================================================== */
    section('22-28. Oppgjør');

    {
      // Pure arithmetic first: the settlement rules, without a database.
      const rates = { incomePerDay: 9000, operatingCostPerDay: 4000 };
      const now = new Date();

      const oneDay = calculateBusinessSettlement(
        { ...rates, lastSettlementAt: new Date(now.getTime() - DAY_MS) },
        now,
      );
      check('ett døgn gir netto 5 000', oneDay.net === 5000, `${oneDay.net}`);

      const halfDay = calculateBusinessSettlement(
        { ...rates, lastSettlementAt: new Date(now.getTime() - DAY_MS / 2) },
        now,
      );
      check('tolv timer gir netto 2 500', halfDay.net === 2500, `${halfDay.net}`);

      const dayAndHalf = calculateBusinessSettlement(
        { ...rates, lastSettlementAt: new Date(now.getTime() - DAY_MS * 1.5) },
        now,
      );
      check('36 timer gir netto 7 500', dayAndHalf.net === 7500, `${dayAndHalf.net}`);

      const week = calculateBusinessSettlement(
        { ...rates, lastSettlementAt: new Date(now.getTime() - DAY_MS * MAX_SETTLEMENT_DAYS) },
        now,
      );
      check('sju døgn gir netto 35 000', week.net === 35000, `${week.net}`);
      check('sju døgn er ikke over taket', !week.capped);

      const month = calculateBusinessSettlement(
        { ...rates, lastSettlementAt: new Date(now.getTime() - DAY_MS * 30) },
        now,
      );
      check('30 døgn kappes til sju', month.net === 35000, `${month.net}`);
      check('kappingen markeres', month.capped);
      check('taket er sju dager', MAX_SETTLEMENT_DAYS === 7);

      const nothing = calculateBusinessSettlement(
        { ...rates, lastSettlementAt: now },
        now,
      );
      check('ingen tid gir ingen inntekt', nothing.net === 0);
      check(
        'null netto flytter ikke tidsstempelet',
        nothing.nextSettlementAt.getTime() === now.getTime(),
      );

      // A short visit earns nothing yet, but must not throw the time away, or
      // a player who refreshes often would never earn anything at all.
      const brief = calculateBusinessSettlement(
        { incomePerDay: 1250, operatingCostPerDay: 0, lastSettlementAt: new Date(now.getTime() - 10_000) },
        now,
      );
      check('ti sekunder gir 0 kr', brief.net === 0, `${brief.net}`);
      check(
        'de ti sekundene går ikke tapt',
        brief.nextSettlementAt.getTime() === now.getTime() - 10_000,
      );
    }

    {
      const t = await createTestPlayer({ cash: 1000000 });
      const bought = await buyBusiness(t.player.id, 'nattklubb', 'Neonrommet');

      const fresh = await listBusinesses(t.player.id);
      check(
        'ingen retroaktiv inntekt før kjøpet',
        fresh.businesses[0]?.cashBalance === 0 && fresh.earned === 0,
        `${fresh.businesses[0]?.cashBalance}`,
      );

      await rewind(bought.business.id, DAY_MS);
      const settled = await listBusinesses(t.player.id);

      check('ett døgn krediteres driftskontoen', settled.earned === 5000, `${settled.earned}`);
      check('saldoen står på virksomheten', settled.businesses[0]?.cashBalance === 5000);
      check(
        'oppgjøret flytter tidsstempelet',
        settled.businesses[0]!.lastSettlementAt.getTime() >
          bought.business.lastSettlementAt.getTime(),
      );
      check(
        'oppgjør skriver ingen transaksjon',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: { not: 'VIRKSOMHET_KJOP' } },
        })) === 0,
      );

      const again = await listBusinesses(t.player.id);
      check('oppgjøret kjøres ikke to ganger', again.earned === 0, `${again.earned}`);
      check('saldoen er uendret', again.businesses[0]?.cashBalance === 5000);

      await rewind(bought.business.id, DAY_MS * 30);
      const capped = await listBusinesses(t.player.id);
      check('30 dagers fravær gir sju dager', capped.earned === 35000, `${capped.earned}`);
      check('saldoen er summen', capped.businesses[0]?.cashBalance === 40000);
    }

    /* ================================================================== */
    section('29. Rollback av oppgjør');

    {
      // At the wealth ceiling the ledger refuses the credit, and it does so
      // after the settlement and the zeroing have already been written.
      const t = await createTestPlayer({ cash: 2_000_000_000 });
      const bought = await prisma.business.create({
        data: {
          playerId: t.player.id,
          businessTypeId: 'nattklubb',
          name: 'Taket',
          districtId: 'neon',
          cashBalance: 10000,
          condition: 100,
          activity: 70,
          risk: 3,
          lastSettlementAt: new Date(Date.now() - DAY_MS),
        },
      });

      const result = await settle(() => withdrawFromBusiness(t.player.id, bought.id));
      check('uttaket avvises', !result.ok, 'lyktes uventet');
      check('feilkoden er taket', result.code === 'TAK_NADD', result.code);

      const row = await prisma.business.findUniqueOrThrow({ where: { id: bought.id } });
      check('driftskontoen er rullet tilbake', row.cashBalance === 10000, `${row.cashBalance}`);
      check(
        'oppgjøret er rullet tilbake',
        row.lastSettlementAt.getTime() === bought.lastSettlementAt.getTime(),
        row.lastSettlementAt.toISOString(),
      );
      check('spillerens kontanter er uendret', (await reload(t.player.id)).cash === 2_000_000_000);
      check(
        'ingen transaksjon ble liggende igjen',
        (await prisma.transaction.count({ where: { playerId: t.player.id } })) === 0,
      );
    }

    {
      // A genuine PostgreSQL constraint failure, after the money has moved.
      const t = await createTestPlayer({ cash: 400000 });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "businesses" ADD CONSTRAINT "businesses_rollback_probe" CHECK ("name" <> 'Rullbakk')`,
      );

      try {
        const result = await settle(() => buyBusiness(t.player.id, 'verksted', 'Rullbakk'));
        check('kjøpet feiler på databasefeilen', !result.ok, 'lyktes uventet');

        check('kontantene er rullet tilbake', (await reload(t.player.id)).cash === 400000);
        check('ingen virksomhetsrad ble liggende igjen', (await businessesOf(t.player.id)).length === 0);
        check(
          'ingen kjøpstransaksjon ble liggende igjen',
          (await prisma.transaction.count({ where: { playerId: t.player.id } })) === 0,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "businesses" DROP CONSTRAINT "businesses_rollback_probe"`,
        );
      }
    }

    /* ================================================================== */
    section('30-37. Uttak');

    {
      const t = await createTestPlayer({ cash: 400000 });
      const bought = await buyBusiness(t.player.id, 'verksted', 'Kranbilen');

      const empty = await settle(() => withdrawFromBusiness(t.player.id, bought.business.id));
      check('uttak fra tom konto avvises', !empty.ok, 'lyktes uventet');
      check('feilkoden er tom konto', empty.code === 'INGEN_MIDLER', empty.code);

      await rewind(bought.business.id, DAY_MS * 2);
      const cashBefore = (await reload(t.player.id)).cash;

      const res = await post(server.base, '/virksomheter/uttak', {
        cookie: t.cookie,
        body: { businessId: bought.business.id },
      });

      check('uttak svarer 200', res.status === 200, String(res.status));
      check('uttaket utløste oppgjør', res.body?.amount === 4000, `${res.body?.amount}`);
      check('meldingen er norsk', /Du hentet ut/.test(res.body?.message ?? ''), res.body?.message);

      const row = await prisma.business.findUniqueOrThrow({ where: { id: bought.business.id } });
      check('driftskontoen er tømt', row.cashBalance === 0, `${row.cashBalance}`);

      const after = await reload(t.player.id);
      check('spilleren fikk pengene', after.cash === cashBefore + 4000, `${after.cash}`);

      const ledger = await prisma.transaction.findMany({
        where: { playerId: t.player.id, type: 'VIRKSOMHET_UTTAK' },
      });
      check('uttaket ble bokført', ledger.length === 1, `${ledger.length}`);
      check('beløpet stemmer', ledger[0]?.amount === 4000, `${ledger[0]?.amount}`);
      check('saldoen etter stemmer', ledger[0]?.balanceAfter === after.cash);
    }

    {
      const owner = await createTestPlayer({ cash: 400000 });
      const stranger = await createTestPlayer({ cash: 0 });
      const bought = await buyBusiness(owner.player.id, 'verksted', 'Ikke ditt');
      await rewind(bought.business.id, DAY_MS);
      await listBusinesses(owner.player.id);

      const theft = await settle(() => withdrawFromBusiness(stranger.player.id, bought.business.id));
      check('uttak fra andres virksomhet avvises', !theft.ok, 'lyktes uventet');
      check('svaret er nøytralt', theft.code === 'IKKE_FUNNET', theft.code);
      check('tyven fikk ingenting', (await reload(stranger.player.id)).cash === 0);

      const row = await prisma.business.findUniqueOrThrow({ where: { id: bought.business.id } });
      check('eierens driftskonto er urørt', row.cashBalance === 2000, `${row.cashBalance}`);
    }

    /* ================================================================== */
    section('38-45. Sikkerhet');

    {
      const owner = await createTestPlayer({ cash: 400000 });
      const stranger = await createTestPlayer({ cash: 400000 });
      const bought = await buyBusiness(owner.player.id, 'verksted', 'Privat');

      const read = await get(server.base, `/virksomheter/${bought.business.id}`, {
        cookie: stranger.cookie,
      });
      check('andre spillere kan ikke lese virksomheten', read.status === 404, String(read.status));
      check(
        'svaret lekker ingenting',
        JSON.stringify(read.body ?? {}).includes('Privat') === false,
      );

      const take = await post(server.base, '/virksomheter/uttak', {
        cookie: stranger.cookie,
        body: { businessId: bought.business.id },
      });
      check('andre spillere kan ikke ta ut', take.status === 404, String(take.status));

      const ownerList = await get(server.base, '/virksomheter', { cookie: stranger.cookie });
      check('lista viser bare egne virksomheter', ownerList.body?.businesses?.length === 0);

      const untouched = await prisma.business.findUniqueOrThrow({
        where: { id: bought.business.id },
      });
      check('eierskapet er uendret', untouched.playerId === owner.player.id);
      check('navnet er uendret', untouched.name === 'Privat');
      check('saldoen er uendret', untouched.cashBalance === 0);
    }

    {
      const t = await createTestPlayer({ cash: 3000000 });
      const other = await createTestPlayer({ cash: 0 });

      const res = await post(server.base, '/virksomheter/kjop', {
        cookie: t.cookie,
        body: {
          businessTypeId: 'nattklubb',
          name: 'Test',
          price: 1,
          purchasePrice: 1,
          districtId: 'regjeringskvartalet',
          cashBalance: 999999999,
          incomePerDay: 999999999,
          operatingCostPerDay: 0,
          risk: 1,
          condition: 100,
          activity: 100,
          playerId: other.player.id,
          status: 'ACTIVE',
        },
      });

      check('kjøpet går gjennom', res.status === 201, String(res.status));

      const rows = await businessesOf(t.player.id);
      const row = rows[0]!;
      check('kun én virksomhet ble opprettet', rows.length === 1, `${rows.length}`);
      check('klientens pris ble ignorert', (await reload(t.player.id)).cash === 3000000 - 750000);
      check('klientens distrikt ble ignorert', row.districtId === 'neon', row.districtId);
      check('klientens saldo ble ignorert', row.cashBalance === 0, `${row.cashBalance}`);
      check('klientens risiko ble ignorert', row.risk === 3, `${row.risk}`);
      check('klientens playerId ble ignorert', row.playerId === t.player.id);
      check('den andre spilleren eier ingenting', (await businessesOf(other.player.id)).length === 0);

      const dto = res.body.business;
      check('inntekten er katalogens', dto.incomePerDay === 9000, `${dto.incomePerDay}`);
      check('driftskostnaden er katalogens', dto.operatingCostPerDay === 4000, `${dto.operatingCostPerDay}`);
      check('nettoen er katalogens', dto.netIncomePerDay === 5000, `${dto.netIncomePerDay}`);
    }

    /* ================================================================== */
    section('46. Tjue samtidige kjøp med råd til én');

    {
      // Enough for exactly one workshop.
      const t = await createTestPlayer({ cash: 400000 });

      const results = await burst(20, (i) =>
        settle(() => buyBusiness(t.player.id, 'verksted', `Verksted ${i}`)),
      );
      const ok = results.filter((r) => r.ok);
      const denied = results.filter((r) => r.code === 'IKKE_NOK_MIDLER');

      note(`ok=${ok.length} avvist=${denied.length}`);
      check('nøyaktig ett kjøp lykkes', ok.length === 1, `${ok.length}`);
      check('resten avvises for lite penger', denied.length === 19, `${denied.length}`);

      const after = await reload(t.player.id);
      check('kontanter blir aldri negative', after.cash >= 0, `cash=${after.cash}`);
      check('nøyaktig én betaling', after.cash === 50000, `cash=${after.cash}`);
      check('nøyaktig én virksomhetsrad', (await businessesOf(t.player.id)).length === 1);
      check(
        'nøyaktig én kjøpstransaksjon',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'VIRKSOMHET_KJOP' },
        })) === 1,
      );
    }

    /* ================================================================== */
    section('47. Tjue samtidige kjøp med to virksomheter fra før');

    {
      const t = await createTestPlayer({ cash: 20000000 });
      await buyBusiness(t.player.id, 'naerbutikk', 'Butikk');
      await buyBusiness(t.player.id, 'verksted', 'Verksted');

      const results = await burst(20, (i) =>
        settle(() => buyBusiness(t.player.id, 'drosjesentral', `Sentral ${i}`)),
      );
      const ok = results.filter((r) => r.ok);
      const denied = results.filter((r) => r.code === 'MAKS_VIRKSOMHETER');

      note(`ok=${ok.length} avvist=${denied.length}`);
      check('nøyaktig ett kjøp lykkes', ok.length === 1, `${ok.length}`);
      check('resten avvises av maksgrensen', denied.length === 19, `${denied.length}`);

      const rows = await businessesOf(t.player.id);
      check('spilleren har nøyaktig tre', rows.length === BUSINESS_TUNING.maxBusinesses, `${rows.length}`);
      check('aldri fire', rows.length <= 3);
      check(
        'kun én av dem ble betalt for i dette forsøket',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'VIRKSOMHET_KJOP' },
        })) === 3,
      );
    }

    /* ================================================================== */
    section('48. Tjue samtidige uttak');

    {
      const t = await createTestPlayer({ cash: 1000000 });
      const bought = await buyBusiness(t.player.id, 'nattklubb', 'Kassa');
      // Settled to this instant, so only the seeded balance is in play.
      await prisma.business.update({
        where: { id: bought.business.id },
        data: { cashBalance: 50000, lastSettlementAt: new Date() },
      });
      const cashBefore = (await reload(t.player.id)).cash;

      const results = await burst(20, () =>
        settle(() => withdrawFromBusiness(t.player.id, bought.business.id)),
      );
      const ok = results.filter((r) => r.ok);

      note(`ok=${ok.length} avvist=${results.length - ok.length}`);
      check('nøyaktig ett uttak lykkes', ok.length === 1, `${ok.length}`);

      const row = await prisma.business.findUniqueOrThrow({ where: { id: bought.business.id } });
      check('driftskontoen er 0', row.cashBalance === 0, `${row.cashBalance}`);
      check('driftskontoen er aldri negativ', row.cashBalance >= 0);

      const after = await reload(t.player.id);
      check('spilleren fikk beløpet én gang', after.cash === cashBefore + 50000, `${after.cash}`);
      check(
        'nøyaktig én uttakstransaksjon',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'VIRKSOMHET_UTTAK' },
        })) === 1,
      );
    }

    /* ================================================================== */
    section('49. Samtidige oppgjør');

    {
      const t = await createTestPlayer({ cash: 1000000 });
      const bought = await buyBusiness(t.player.id, 'nattklubb', 'Dobbeltopp');
      await rewind(bought.business.id, DAY_MS);

      const results = await burst(10, () => settle(() => listBusinesses(t.player.id)));
      const credited = results
        .map((r) => (r.ok ? (r.value as { earned: number }).earned : 0))
        .reduce((sum, n) => sum + n, 0);

      note(`kreditert til sammen ${credited} kr`);
      check('inntekten krediteres nøyaktig én gang', credited === 5000, `${credited}`);

      const row = await prisma.business.findUniqueOrThrow({ where: { id: bought.business.id } });
      check('driftskontoen er ett døgn', row.cashBalance === 5000, `${row.cashBalance}`);
      check(
        'tidsstempelet er konsistent',
        row.lastSettlementAt.getTime() > bought.business.lastSettlementAt.getTime() &&
          row.lastSettlementAt.getTime() <= Date.now(),
      );
      check(
        'oppgjør skriver fortsatt ingen transaksjoner',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'VIRKSOMHET_UTTAK' },
        })) === 0,
      );
    }

    /* ================================================================== */
    section('50-51. Kjøp, uttak og bank samtidig');

    {
      const seedCash = 1000000;
      const t = await createTestPlayer({ cash: seedCash, bankBalance: 0 });
      const bought = await buyBusiness(t.player.id, 'naerbutikk', 'Hjørnet');
      await prisma.business.update({
        where: { id: bought.business.id },
        data: { cashBalance: 25000, lastSettlementAt: new Date() },
      });

      const results = await Promise.all([
        settle(() => buyBusiness(t.player.id, 'verksted', 'Samtidig')),
        settle(() => withdrawFromBusiness(t.player.id, bought.business.id)),
        settle(() => withdrawFromBusiness(t.player.id, bought.business.id)),
        settle(() => buyBusiness(t.player.id, 'drosjesentral', 'Samtidig 2')),
        post(server.base, '/spiller/bank/innskudd', { cookie: t.cookie, body: { amount: 10000 } }),
      ]);

      const after = await reload(t.player.id);
      const rows = await businessesOf(t.player.id);
      const ledger = await prisma.transaction.findMany({ where: { playerId: t.player.id } });
      const cashDelta = ledger
        .filter((row) => row.ledger === 'CASH')
        .reduce((sum, row) => sum + row.amount, 0);

      note(
        `cash ${seedCash} -> ${after.cash}, bank ${after.bankBalance}, ` +
          `${rows.length} virksomheter, ${results.filter((r) => 'ok' in r && r.ok).length} tjenestekall ok`,
      );

      check('kontanter er aldri negative', after.cash >= 0, `${after.cash}`);
      check('banksaldoen er aldri negativ', after.bankBalance >= 0, `${after.bankBalance}`);
      check('maksgrensen holder', rows.length <= BUSINESS_TUNING.maxBusinesses, `${rows.length}`);
      check(
        'ingen spøkelsesvirksomheter',
        rows.every((row) => row.playerId === t.player.id && row.cashBalance >= 0),
      );
      check(
        'driftskontoen ble hentet ut høyst én gang',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'VIRKSOMHET_UTTAK' },
        })) <= 1,
      );
      check(
        'regnskapet forklarer hele endringen i kontanter',
        cashDelta === after.cash - seedCash,
        `${cashDelta} vs ${after.cash - seedCash}`,
      );
      check(
        'summen av virksomhetssaldoer er aldri negativ',
        rows.reduce((sum, row) => sum + row.cashBalance, 0) >= 0,
      );
    }

    /* ================================================================== */
    section('54-59. API');

    {
      const t = await createTestPlayer({ cash: 3000000 });
      await buyBusiness(t.player.id, 'verksted', 'Rømmas Verksted');
      await buyBusiness(t.player.id, 'nattklubb', 'Neonrommet');

      const list = await get(server.base, '/virksomheter', { cookie: t.cookie });
      check('lista svarer 200', list.status === 200, String(list.status));
      check('to virksomheter', list.body?.count === 2, `${list.body?.count}`);
      check('maksgrensen oppgis', list.body?.maxBusinesses === 3, `${list.body?.maxBusinesses}`);

      const expectedValue =
        calculateBusinessValue(350000, 100) + calculateBusinessValue(750000, 100);
      check(
        'samlet verdi er pris ganger tilstand',
        list.body?.totalValue === expectedValue,
        `${list.body?.totalValue} vs ${expectedValue}`,
      );

      const keys = Object.keys(list.body.businesses[0]).sort();
      const expectedKeys = [
        'activity',
        'businessTypeId',
        'cashBalance',
        'condition',
        'districtId',
        'districtName',
        'estimatedValue',
        'id',
        'incomePerDay',
        'lastSettlementAt',
        'name',
        'netIncomePerDay',
        'operatingCostPerDay',
        'purchasedAt',
        'risk',
        'riskLabel',
        'typeName',
      ];
      check(
        'serialiseringen har nøyaktig de feltene den skal',
        JSON.stringify(keys) === JSON.stringify(expectedKeys),
        keys.join(','),
      );
      check(
        'ingen interne felter lekker',
        ['playerId', 'createdAt', 'updatedAt'].every((k) => !keys.includes(k)),
      );
      check(
        'navn og type vises hver for seg',
        list.body.businesses[0].name === 'Rømmas Verksted' &&
          list.body.businesses[0].typeName === 'Verksted',
      );
      check(
        'distriktsnavnet er norsk',
        list.body.businesses[0].districtName === 'Havna',
        list.body.businesses[0].districtName,
      );
      check(
        'risikoetiketten er norsk',
        list.body.businesses[0].riskLabel === 'Middels',
        list.body.businesses[0].riskLabel,
      );

      const one = await get(server.base, `/virksomheter/${list.body.businesses[0].id}`, {
        cookie: t.cookie,
      });
      check('detaljendepunktet svarer 200', one.status === 200, String(one.status));
      check('det er riktig virksomhet', one.body?.business?.id === list.body.businesses[0].id);
      check(
        'detaljen har samme felter som lista',
        JSON.stringify(Object.keys(one.body.business).sort()) === JSON.stringify(expectedKeys),
      );

      const missing = await get(server.base, '/virksomheter/finnes-ikke', { cookie: t.cookie });
      check('ukjent virksomhet gir 404', missing.status === 404, String(missing.status));
      check(
        'meldingen er norsk',
        /Fant ikke denne virksomheten/.test(missing.body?.error?.message ?? ''),
        missing.body?.error?.message,
      );

      const unknownType = await post(server.base, '/virksomheter/kjop', {
        cookie: t.cookie,
        body: { businessTypeId: 'kasino', name: 'Finnes ikke' },
      });
      check('ukjent virksomhetstype gir 400', unknownType.status === 400, String(unknownType.status));
      check(
        'meldingen er norsk',
        /Ukjent virksomhet/.test(unknownType.body?.error?.message ?? ''),
        unknownType.body?.error?.message,
      );

      const catalog = await get(server.base, '/virksomheter/katalog', { cookie: t.cookie });
      check('katalogendepunktet svarer 200', catalog.status === 200, String(catalog.status));
      check('katalogen har seks oppføringer', catalog.body?.catalog?.length === 6);
      check(
        'katalogen oppgir nettoinntekt',
        catalog.body.catalog.find((c: any) => c.id === 'verksted')?.netIncomePerDay === 2000,
      );

      // Affordability is the server's call, resolved against the player's own
      // cash rather than anything the browser knows.
      const poor = await createTestPlayer({ cash: 250000 });
      const poorCatalog = await get(server.base, '/virksomheter/katalog', {
        cookie: poor.cookie,
      });
      check(
        'råd-flagget beregnes av serveren',
        poorCatalog.body.catalog.find((c: any) => c.id === 'naerbutikk')?.affordable === true &&
          poorCatalog.body.catalog.find((c: any) => c.id === 'konsulentselskap')?.affordable ===
            false,
      );
    }

    {
      // With three businesses owned, nothing in the catalogue is buyable.
      const t = await createTestPlayer({ cash: 20000000 });
      await buyBusiness(t.player.id, 'naerbutikk', 'En');
      await buyBusiness(t.player.id, 'verksted', 'To');
      await buyBusiness(t.player.id, 'drosjesentral', 'Tre');

      const catalog = await get(server.base, '/virksomheter/katalog', { cookie: t.cookie });
      check(
        'ved maks tre er ingenting kjøpbart',
        catalog.body.catalog.every((c: any) => c.affordable === false),
      );
      check('katalogen oppgir antallet', catalog.body?.count === 3, `${catalog.body?.count}`);
    }

    /* ================================================================== */
    section('Uautentisert tilgang');

    {
      const list = await get(server.base, '/virksomheter');
      check('lista krever innlogging', list.status === 401, String(list.status));

      const buy = await post(server.base, '/virksomheter/kjop', {
        body: { businessTypeId: 'verksted', name: 'Uten konto' },
      });
      check('kjøp krever innlogging', buy.status === 401, String(buy.status));

      const take = await post(server.base, '/virksomheter/uttak', {
        body: { businessId: 'hva-som-helst' },
      });
      check('uttak krever innlogging', take.status === 401, String(take.status));
    }

    /* ================================================================== */
    section('Økonomisk invariant');

    {
      const t = await createTestPlayer({ cash: 1000000 });
      const bought = await buyBusiness(t.player.id, 'nattklubb', 'Regnskapet');
      await rewind(bought.business.id, DAY_MS * 3);
      await listBusinesses(t.player.id);
      await withdrawFromBusiness(t.player.id, bought.business.id);

      const after = await reload(t.player.id);
      const ledger = await prisma.transaction.findMany({ where: { playerId: t.player.id } });
      const cashDelta = ledger
        .filter((row) => row.ledger === 'CASH')
        .reduce((sum, row) => sum + row.amount, 0);

      check(
        'regnskapet forklarer hele saldoendringen',
        cashDelta === after.cash - 1000000,
        `${cashDelta} vs ${after.cash - 1000000}`,
      );
      check(
        'kjøp og uttak er de eneste bevegelsene',
        ledger.every((row) =>
          ['VIRKSOMHET_KJOP', 'VIRKSOMHET_UTTAK'].includes(row.type),
        ),
        ledger.map((r) => r.type).join(','),
      );
      check('spilleren fikk tre døgn', after.cash === 1000000 - 750000 + 15000, `${after.cash}`);
      check(
        'ingen daglige transaksjonsrader',
        ledger.length === 2,
        `${ledger.length} rader`,
      );

      const detail = await getBusiness(t.player.id, bought.business.id);
      check('driftskontoen står i 0 etter uttak', detail.business.cashBalance === 0);
    }

    /* ================================================================== */
    section('Databasens egne skranker');

    {
      const t = await createTestPlayer({ cash: 400000 });
      const bought = await buyBusiness(t.player.id, 'verksted', 'Skranker');

      const negative = await settle(() =>
        prisma.business.update({
          where: { id: bought.business.id },
          data: { cashBalance: -1 },
        }),
      );
      check('databasen nekter negativ driftskonto', !negative.ok, 'lyktes uventet');

      const badCondition = await settle(() =>
        prisma.business.update({
          where: { id: bought.business.id },
          data: { condition: 101 },
        }),
      );
      check('databasen nekter tilstand over 100', !badCondition.ok, 'lyktes uventet');

      const badRisk = await settle(() =>
        prisma.business.update({ where: { id: bought.business.id }, data: { risk: 9 } }),
      );
      check('databasen nekter risiko utenfor 1-5', !badRisk.ok, 'lyktes uventet');

      const badActivity = await settle(() =>
        prisma.business.update({ where: { id: bought.business.id }, data: { activity: -5 } }),
      );
      check('databasen nekter aktivitet under 0', !badActivity.ok, 'lyktes uventet');
    }

    /* ================================================================== */
    section('Ingen andre systemer er rørt');

    {
      const t = await createTestPlayer({ cash: 400000, energy: 100, heat: 0 });
      const before = await reload(t.player.id);
      const bought = await buyBusiness(t.player.id, 'verksted', 'Nøytral');
      await rewind(bought.business.id, DAY_MS);
      await listBusinesses(t.player.id);
      await withdrawFromBusiness(t.player.id, bought.business.id);
      const after = await reload(t.player.id);

      check('energien er urørt', after.energy === before.energy, `${after.energy}`);
      check('heat er urørt', after.heat === before.heat, `${after.heat}`);
      check('helsa er urørt', after.health === before.health);
      check('XP er urørt', after.xp === before.xp);
      check('ferdighetspoeng er urørt', after.skillPoints === before.skillPoints);
      check('distriktet er urørt', after.currentDistrictId === before.currentDistrictId);
      check(
        'ingen kriminalitetsforsøk ble skrevet',
        (await prisma.crimeAttempt.count({ where: { playerId: t.player.id } })) === 0,
      );
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
