/**
 * Integration tests for the property system, against the real PostgreSQL
 * database and a real Express server.
 *
 * Two things this suite exists to prove: that a property's address is the
 * catalogue's and never the player's own district, and that the price stored on
 * the row - not the catalogue - is what every later valuation is built from.
 *
 * Run with `npm -w @skyggeby/server run test:properties`.
 */
import {
  PROPERTY_TUNING,
  PROPERTY_TYPES,
  calculatePropertySaleValue,
  calculatePropertyValue,
  findPropertyType,
  propertySecurityLabel,
  validatePropertyCatalogue,
} from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/errors';
import {
  buyProperty,
  getProperty,
  listProperties,
  sellProperty,
} from '../src/modules/properties/property.service';
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

async function propertiesOf(playerId: string) {
  return prisma.property.findMany({ where: { playerId }, orderBy: { purchasedAt: 'asc' } });
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1. Katalogen');

    {
      check('katalogen har seks typer', PROPERTY_TYPES.length === 6, `${PROPERTY_TYPES.length}`);

      const ids = PROPERTY_TYPES.map((p) => p.id);
      check('alle id-er er unike', new Set(ids).size === ids.length);
      const names = PROPERTY_TYPES.map((p) => p.name);
      check('alle navn er unike', new Set(names).size === names.length);

      // The v1 balance, spelled out.
      const expected: Record<string, [number, string, number, number]> = {
        'rom-i-kollektiv': [25000, 'blokkene', 5, 1],
        'liten-leilighet': [100000, 'blokkene', 10, 2],
        sentrumsleilighet: [250000, 'sentrum', 15, 2],
        rekkehus: [500000, 'havna', 25, 3],
        'moderne-villa': [1000000, 'neon', 40, 4],
        luksuseiendom: [2500000, 'regjeringskvartalet', 60, 5],
      };
      check(
        'priser, distrikter, kapasitet og sikkerhet stemmer',
        PROPERTY_TYPES.every((p) => {
          const [price, district, storage, security] = expected[p.id]!;
          return (
            p.purchasePrice === price &&
            p.districtId === district &&
            p.storageCapacity === storage &&
            p.security === security &&
            p.condition === 100
          );
        }),
        PROPERTY_TYPES.map((p) => `${p.id}=${p.purchasePrice}/${p.districtId}`).join(','),
      );

      check(
        'alle priser er positive heltall',
        PROPERTY_TYPES.every((p) => Number.isInteger(p.purchasePrice) && p.purchasePrice > 0),
      );
      check('all lagringsplass er over 0', PROPERTY_TYPES.every((p) => p.storageCapacity > 0));
      check(
        'sikkerhet er 1-5 og tilstand 0-100',
        PROPERTY_TYPES.every(
          (p) => p.security >= 1 && p.security <= 5 && p.condition >= 0 && p.condition <= 100,
        ),
      );

      const problems = validatePropertyCatalogue();
      check('katalogvalideringen finner ingen feil', problems.length === 0, problems.join('; '));
      check('ukjent type gir undefined', findPropertyType('slott') === undefined);

      check(
        'sikkerhetsetikettene er norske',
        [1, 2, 3, 4, 5].map(propertySecurityLabel).join(',') ===
          'Svært lav,Lav,Middels,Høy,Svært høy',
        [1, 2, 3, 4, 5].map(propertySecurityLabel).join(','),
      );

      // Value arithmetic, without a database.
      check('full tilstand gir full verdi', calculatePropertyValue(500000, 100) === 500000);
      check('halv tilstand gir halv verdi', calculatePropertyValue(500000, 50) === 250000);
      check('verdien rundes ned', calculatePropertyValue(999, 33) === 329,
        `${calculatePropertyValue(999, 33)}`);
      check('salgsverdien er 80 %', calculatePropertySaleValue(1000000, 100) === 800000);
      check(
        'salgsverdien skaleres med tilstand',
        calculatePropertySaleValue(1000000, 50) === 400000,
        `${calculatePropertySaleValue(1000000, 50)}`,
      );
      check('verdier er aldri negative', calculatePropertyValue(1000, -50) === 0);

      const t = await createTestPlayer({ cash: 300000 });
      const res = await get(server.base, '/eiendom/katalog', { cookie: t.cookie });
      check('katalogendepunktet svarer 200', res.status === 200, String(res.status));
      check('den har seks oppføringer', res.body?.catalog?.length === 6);
      check('maksgrensen oppgis', res.body?.maxProperties === 3, `${res.body?.maxProperties}`);
      check(
        'råd-flagget beregnes av serveren',
        res.body.catalog.find((c: any) => c.id === 'sentrumsleilighet')?.affordable === true &&
          res.body.catalog.find((c: any) => c.id === 'luksuseiendom')?.affordable === false,
      );
      check(
        'katalogen oppgir norsk distriktsnavn',
        res.body.catalog.find((c: any) => c.id === 'moderne-villa')?.districtName === 'Neon',
      );
      check(
        'og norsk sikkerhetsetikett',
        res.body.catalog.find((c: any) => c.id === 'luksuseiendom')?.securityLabel === 'Svært høy',
      );
    }

    /* ================================================================== */
    section('2. Kjøp');

    {
      // The player is standing somewhere else entirely: the address must come
      // from the catalogue, not from where they happen to be.
      const t = await createTestPlayer({ cash: 1500000, currentDistrictId: 'neon' });

      const res = await post(server.base, '/eiendom/kjop', {
        cookie: t.cookie,
        body: { propertyTypeId: 'rekkehus', name: '  Hoved   kvarteret  ' },
      });

      check('kjøp svarer 201', res.status === 201, String(res.status));
      check('meldingen er norsk', /Du kjøpte rekkehus for/.test(res.body?.message ?? ''),
        res.body?.message);

      const after = await reload(t.player.id);
      check('serverprisen ble trukket', after.cash === 1500000 - 500000, `cash=${after.cash}`);

      const rows = await propertiesOf(t.player.id);
      check('eiendommen ble opprettet', rows.length === 1, `${rows.length}`);

      const row = rows[0]!;
      check('navnet ble trimmet og normalisert', row.name === 'Hoved kvarteret',
        `"${row.name}"`);
      check('adressen er katalogens, ikke spillerens', row.districtId === 'havna',
        row.districtId);
      check('kjøpsprisen ble kopiert til raden', row.purchasePrice === 500000);
      check('nåverdien er lik kjøpsprisen', row.currentValue === 500000);
      check('tilstanden starter på 100', row.condition === 100);
      check('lagringsplassen er katalogens', row.storageCapacity === 25, `${row.storageCapacity}`);
      check('sikkerheten er katalogens', row.security === 3, `${row.security}`);

      const player = await reload(t.player.id);
      check('spilleren står fortsatt i Neon', player.currentDistrictId === 'neon');

      const ledger = await prisma.transaction.findMany({ where: { playerId: t.player.id } });
      check('kjøpet ble bokført én gang', ledger.length === 1, `${ledger.length}`);
      check('typen er eiendomskjøp', ledger[0]?.type === 'EIENDOM_KJOP', ledger[0]?.type);
      check('beløpet er negativt og korrekt', ledger[0]?.amount === -500000);
      check('saldoen etter er bokført', ledger[0]?.balanceAfter === 1000000);

      const dto = res.body.property;
      check('DTO-en har spillerens navn', dto?.name === 'Hoved kvarteret');
      check('DTO-en har katalogtypen', dto?.typeName === 'Rekkehus');
      check('DTO-en har distriktsnavn', dto?.districtName === 'Havna');
      check('DTO-en har salgsverdi', dto?.saleValue === 400000, `${dto?.saleValue}`);
      check('DTO-en har sikkerhetsetikett', dto?.securityLabel === 'Middels', dto?.securityLabel);
      check(
        'DTO-en har nøyaktig de feltene den skal',
        JSON.stringify(Object.keys(dto).sort()) ===
          JSON.stringify([
            'condition',
            'currentValue',
            'description',
            'districtId',
            'districtName',
            'id',
            'name',
            'propertyTypeId',
            'purchasePrice',
            'purchasedAt',
            'saleValue',
            'security',
            'securityLabel',
            'storageCapacity',
            'typeName',
          ]),
        Object.keys(dto).join(','),
      );
    }

    {
      const poor = await createTestPlayer({ cash: 24999 });
      const denied = await settle(() =>
        buyProperty(poor.player.id, 'rom-i-kollektiv', 'For dyrt'),
      );
      check('kjøp uten nok kontanter avvises', !denied.ok, 'lyktes uventet');
      check('feilkoden er midler', denied.code === 'IKKE_NOK_MIDLER', denied.code);
      check('ingen eiendomsrad', (await propertiesOf(poor.player.id)).length === 0);
      check(
        'ingen transaksjon',
        (await prisma.transaction.count({ where: { playerId: poor.player.id } })) === 0,
      );
    }

    /* ================================================================== */
    section('3. Navn');

    {
      const t = await createTestPlayer({ cash: 500000 });

      const cases: Array<[string, unknown, RegExp]> = [
        ['for kort navn', { propertyTypeId: 'rom-i-kollektiv', name: 'ab' }, /minst 3 tegn/],
        [
          'for langt navn',
          { propertyTypeId: 'rom-i-kollektiv', name: 'x'.repeat(33) },
          /maks 32 tegn/,
        ],
        ['tomt navn', { propertyTypeId: 'rom-i-kollektiv', name: '' }, /minst 3 tegn/],
        [
          'navn med bare mellomrom',
          { propertyTypeId: 'rom-i-kollektiv', name: '      ' },
          /minst 3 tegn/,
        ],
        ['manglende navn', { propertyTypeId: 'rom-i-kollektiv' }, /navn/i],
        ['ukjent type', { propertyTypeId: 'slott', name: 'Slottet' }, /Ukjent eiendom/],
        ['manglende type', { name: 'Uten type' }, /eiendom/i],
      ];

      for (const [name, body, pattern] of cases) {
        const res = await post(server.base, '/eiendom/kjop', { cookie: t.cookie, body });
        check(`${name} avvises`, res.status === 400, String(res.status));
        check(
          `${name}: meldingen er norsk`,
          pattern.test(res.body?.error?.message ?? ''),
          res.body?.error?.message,
        );
      }

      check('ingenting ble opprettet', (await propertiesOf(t.player.id)).length === 0);
      check('ingenting ble trukket', (await reload(t.player.id)).cash === 500000);

      // Text that looks like an attack is text.
      // Short enough to be a legal name; the point is that it stays text.
      const xss = '<script>alert(1)</script>';
      const nasty = await post(server.base, '/eiendom/kjop', {
        cookie: t.cookie,
        body: { propertyTypeId: 'rom-i-kollektiv', name: xss },
      });
      check('XSS-lignende navn lagres som tekst', nasty.status === 201, String(nasty.status));
      check('og returneres uendret', nasty.body?.property?.name === xss,
        nasty.body?.property?.name);

      const sql = await post(server.base, '/eiendom/kjop', {
        cookie: t.cookie,
        body: { propertyTypeId: 'rom-i-kollektiv', name: "'; DROP TABLE properties;--" },
      });
      check('SQL-lignende navn håndteres trygt', sql.status === 201, String(sql.status));
      check('tabellen står fortsatt', (await propertiesOf(t.player.id)).length === 2);

      const stored = await prisma.property.findFirstOrThrow({
        where: { playerId: t.player.id, name: xss },
      });
      check('teksten lagres uendret i databasen', stored.name === xss);
    }

    /* ================================================================== */
    section('4. Maks tre eiendommer');

    {
      const t = await createTestPlayer({ cash: 1000000 });
      await buyProperty(t.player.id, 'rom-i-kollektiv', 'Første');
      await buyProperty(t.player.id, 'liten-leilighet', 'Andre');
      await buyProperty(t.player.id, 'sentrumsleilighet', 'Tredje');

      check('spilleren har tre', (await propertiesOf(t.player.id)).length === 3);

      const cashBefore = (await reload(t.player.id)).cash;
      const fourth = await settle(() =>
        buyProperty(t.player.id, 'rom-i-kollektiv', 'Fjerde'),
      );
      check('den fjerde avvises', !fourth.ok, 'lyktes uventet');
      check('feilkoden er maksgrensen', fourth.code === 'MAKS_EIENDOMMER', fourth.code);
      check('fortsatt tre', (await propertiesOf(t.player.id)).length === 3);
      check('ingenting ble trukket', (await reload(t.player.id)).cash === cashBefore);

      const catalog = await get(server.base, '/eiendom/katalog', { cookie: t.cookie });
      check(
        'ved maks er ingenting kjøpbart',
        catalog.body.catalog.every((c: any) => c.affordable === false),
      );
      check('katalogen oppgir antallet', catalog.body?.count === 3, `${catalog.body?.count}`);
    }

    /* ================================================================== */
    section('5. Salg');

    {
      const t = await createTestPlayer({ cash: 1500000 });
      const bought = await buyProperty(t.player.id, 'rekkehus', 'Selges');
      const cashBefore = (await reload(t.player.id)).cash;

      const res = await post(server.base, '/eiendom/selg', {
        cookie: t.cookie,
        body: { propertyId: bought.property.id },
      });

      check('salg svarer 200', res.status === 200, String(res.status));
      check('salgssummen er 80 % av kjøpspris', res.body?.saleValue === 400000,
        `${res.body?.saleValue}`);
      check('meldingen er norsk', /Du solgte Selges for/.test(res.body?.message ?? ''),
        res.body?.message);

      const after = await reload(t.player.id);
      check('spilleren fikk pengene', after.cash === cashBefore + 400000, `${after.cash}`);
      check('eiendommen er borte', (await propertiesOf(t.player.id)).length === 0);

      const sale = await prisma.transaction.findFirstOrThrow({
        where: { playerId: t.player.id, type: 'EIENDOM_SALG' },
      });
      check('salget ble bokført', sale.amount === 400000);
      check('beskrivelsen navngir eiendommen', sale.description === 'Solgte Selges',
        sale.description ?? '');

      const again = await settle(() => sellProperty(t.player.id, bought.property.id));
      check('å selge den igjen avvises', !again.ok, 'lyktes uventet');
      check('svaret er nøytralt', again.code === 'IKKE_FUNNET', again.code);
    }

    {
      // The sale value follows the row, not the catalogue: a rebalancing must
      // not change what somebody already owns.
      const t = await createTestPlayer({ cash: 300000 });
      const bought = await buyProperty(t.player.id, 'sentrumsleilighet', 'Historikk');

      await prisma.property.update({
        where: { id: bought.property.id },
        data: {
          purchasePrice: 120000,
          currentValue: calculatePropertyValue(120000, 60),
          condition: 60,
        },
      });

      const detail = await get(server.base, `/eiendom/${bought.property.id}`, {
        cookie: t.cookie,
      });
      check('nåverdien følger raden', detail.body?.property?.currentValue === 72000,
        `${detail.body?.property?.currentValue}`);
      check('salgsverdien følger raden', detail.body?.property?.saleValue === 57600,
        `${detail.body?.property?.saleValue}`);

      const cashBefore = (await reload(t.player.id)).cash;
      const sold = await sellProperty(t.player.id, bought.property.id);
      check('salget bruker radens pris', sold.saleValue === 57600, `${sold.saleValue}`);
      check('spilleren fikk radens beløp',
        (await reload(t.player.id)).cash === cashBefore + 57600);
    }

    /* ================================================================== */
    section('6. Lesing og eierskap');

    {
      const owner = await createTestPlayer({ cash: 1000000 });
      const stranger = await createTestPlayer({ cash: 1000000 });
      const a = await buyProperty(owner.player.id, 'rom-i-kollektiv', 'Basen');
      await buyProperty(owner.player.id, 'liten-leilighet', 'Leiligheten');

      const list = await get(server.base, '/eiendom', { cookie: owner.cookie });
      check('lista svarer 200', list.status === 200, String(list.status));
      check('to eiendommer', list.body?.count === 2, `${list.body?.count}`);
      check('maksgrensen oppgis', list.body?.maxProperties === 3);
      check('samlet verdi er summen av radene', list.body?.totalValue === 125000,
        `${list.body?.totalValue}`);

      const detail = await get(server.base, `/eiendom/${a.property.id}`, {
        cookie: owner.cookie,
      });
      check('detaljen svarer 200', detail.status === 200, String(detail.status));
      check('det er riktig eiendom', detail.body?.property?.id === a.property.id);
      check('kjøpsdato er med', typeof detail.body?.property?.purchasedAt === 'string');

      const asStranger = await get(server.base, `/eiendom/${a.property.id}`, {
        cookie: stranger.cookie,
      });
      check('andres eiendom gir 404', asStranger.status === 404, String(asStranger.status));
      check(
        'svaret lekker ingenting',
        !JSON.stringify(asStranger.body ?? {}).includes('Basen'),
      );
      check(
        'meldingen er norsk',
        /Fant ikke denne eiendommen/.test(asStranger.body?.error?.message ?? ''),
        asStranger.body?.error?.message,
      );

      const strangerList = await get(server.base, '/eiendom', { cookie: stranger.cookie });
      check('lista viser bare egne', strangerList.body?.count === 0);

      const theft = await post(server.base, '/eiendom/selg', {
        cookie: stranger.cookie,
        body: { propertyId: a.property.id },
      });
      check('andres eiendom kan ikke selges', theft.status === 404, String(theft.status));
      check('eiendommen står urørt',
        (await prisma.property.count({ where: { id: a.property.id } })) === 1);
      check('tyven fikk ingenting', (await reload(stranger.player.id)).cash === 1000000);

      const unknown = await get(server.base, '/eiendom/finnes-ikke', { cookie: owner.cookie });
      check('ukjent eiendom gir 404', unknown.status === 404, String(unknown.status));

      const unknownSell = await post(server.base, '/eiendom/selg', {
        cookie: owner.cookie,
        body: { propertyId: 'finnes-ikke' },
      });
      check('salg av ukjent id gir 404', unknownSell.status === 404, String(unknownSell.status));

      const emptyId = await post(server.base, '/eiendom/selg', {
        cookie: owner.cookie,
        body: { propertyId: '' },
      });
      check('tom id avvises', emptyId.status === 400, String(emptyId.status));
    }

    {
      const t = await createTestPlayer({ cash: 100000 });
      const bought = await buyProperty(t.player.id, 'rom-i-kollektiv', 'Innlogging');

      const paths: Array<[string, () => Promise<{ status: number }>]> = [
        ['lista', () => get(server.base, '/eiendom')],
        ['katalogen', () => get(server.base, '/eiendom/katalog')],
        ['detaljen', () => get(server.base, `/eiendom/${bought.property.id}`)],
        [
          'kjøp',
          () =>
            post(server.base, '/eiendom/kjop', {
              body: { propertyTypeId: 'rom-i-kollektiv', name: 'Uten konto' },
            }),
        ],
        [
          'salg',
          () =>
            post(server.base, '/eiendom/selg', {
              body: { propertyId: bought.property.id },
            }),
        ],
      ];

      for (const [name, call] of paths) {
        const res = await call();
        check(`${name} krever innlogging`, res.status === 401, String(res.status));
      }

      check('ingenting ble endret', (await propertiesOf(t.player.id)).length === 1);
    }

    /* ================================================================== */
    section('7. Manipulerte klientfelter');

    {
      const t = await createTestPlayer({ cash: 3000000, currentDistrictId: 'blokkene' });
      const other = await createTestPlayer({ cash: 0 });

      const res = await post(server.base, '/eiendom/kjop', {
        cookie: t.cookie,
        body: {
          propertyTypeId: 'luksuseiendom',
          name: 'Min villa',
          price: 1,
          purchasePrice: 1,
          currentValue: 999999999,
          condition: 1,
          security: 1,
          storageCapacity: 999,
          districtId: 'blokkene',
          playerId: other.player.id,
          cash: 999999999,
          saleValue: 999999,
          id: 'valgt-av-klienten',
        },
      });

      check('kjøpet går gjennom', res.status === 201, String(res.status));

      const rows = await propertiesOf(t.player.id);
      const row = rows[0]!;
      check('kun én eiendom ble opprettet', rows.length === 1, `${rows.length}`);
      check('klientens pris ble ignorert', row.purchasePrice === 2500000);
      check('faktisk trekk er katalogens pris',
        (await reload(t.player.id)).cash === 3000000 - 2500000);
      check('klientens nåverdi ble ignorert', row.currentValue === 2500000);
      check('klientens tilstand ble ignorert', row.condition === 100);
      check('klientens distrikt ble ignorert', row.districtId === 'regjeringskvartalet',
        row.districtId);
      check('klientens sikkerhet ble ignorert', row.security === 5, `${row.security}`);
      check('klientens kapasitet ble ignorert', row.storageCapacity === 60,
        `${row.storageCapacity}`);
      check('klientens id ble ignorert', row.id !== 'valgt-av-klienten');
      check('klientens playerId ble ignorert', row.playerId === t.player.id);
      check('den andre spilleren eier ingenting',
        (await propertiesOf(other.player.id)).length === 0);
      check('og fikk ingen penger', (await reload(other.player.id)).cash === 0);

      const blob = JSON.stringify(res.body);
      for (const field of ['passwordHash', 'usernameLower', 'token', 'expiresAt']) {
        check(`${field} lekker ikke`, !blob.includes(field));
      }
      check('den andre spillerens id er ikke i svaret', !blob.includes(other.player.id));
    }

    /* ================================================================== */
    section('8. Databasens egne skranker');

    {
      const t = await createTestPlayer({ cash: 100000 });
      const bought = await buyProperty(t.player.id, 'rom-i-kollektiv', 'Skranker');
      const id = bought.property.id;

      const cases: Array<[string, Record<string, unknown>]> = [
        ['negativ kjøpspris', { purchasePrice: -1 }],
        ['negativ nåverdi', { currentValue: -1 }],
        ['tilstand over 100', { condition: 101 }],
        ['tilstand under 0', { condition: -1 }],
        ['negativ lagringsplass', { storageCapacity: -1 }],
        ['sikkerhet over 5', { security: 6 }],
        ['sikkerhet under 1', { security: 0 }],
        ['for kort navn', { name: 'ab' }],
        ['navn med bare mellomrom', { name: '    ' }],
        ['for langt navn', { name: 'x'.repeat(40) }],
      ];

      for (const [name, data] of cases) {
        const result = await settle(() => prisma.property.update({ where: { id }, data }));
        check(`databasen nekter ${name}`, !result.ok, 'lyktes uventet');
      }

      const untouched = await prisma.property.findUniqueOrThrow({ where: { id } });
      check('raden er uendret', untouched.name === 'Skranker' && untouched.condition === 100);
    }

    /* ================================================================== */
    section('9. Tjue samtidige kjøp med råd til én');

    {
      // Enough for exactly one terraced house.
      const t = await createTestPlayer({ cash: 600000 });

      const results = await burst(20, (i) =>
        settle(() => buyProperty(t.player.id, 'rekkehus', `Rekkehus ${i}`)),
      );
      const ok = results.filter((r) => r.ok);
      const denied = results.filter((r) => r.code === 'IKKE_NOK_MIDLER');

      note(`ok=${ok.length} avvist=${denied.length}`);
      check('nøyaktig ett kjøp lykkes', ok.length === 1, `${ok.length}`);
      check('resten avvises for lite penger', denied.length === 19, `${denied.length}`);

      const after = await reload(t.player.id);
      check('kontanter blir aldri negative', after.cash >= 0, `${after.cash}`);
      check('nøyaktig én betaling', after.cash === 100000, `${after.cash}`);
      check('nøyaktig én eiendom', (await propertiesOf(t.player.id)).length === 1);
      check(
        'nøyaktig én kjøpstransaksjon',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'EIENDOM_KJOP' },
        })) === 1,
      );
    }

    /* ================================================================== */
    section('10. Tjue samtidige kjøp ved to fra før');

    {
      const t = await createTestPlayer({ cash: 20000000 });
      await buyProperty(t.player.id, 'rom-i-kollektiv', 'Nummer én');
      await buyProperty(t.player.id, 'liten-leilighet', 'Nummer to');

      const results = await burst(20, (i) =>
        settle(() => buyProperty(t.player.id, 'sentrumsleilighet', `Tre ${i}`)),
      );
      const ok = results.filter((r) => r.ok);
      const denied = results.filter((r) => r.code === 'MAKS_EIENDOMMER');

      note(`ok=${ok.length} avvist=${denied.length}`);
      check('nøyaktig ett kjøp lykkes', ok.length === 1, `${ok.length}`);
      check('resten avvises av maksgrensen', denied.length === 19, `${denied.length}`);
      check('spilleren har nøyaktig tre', (await propertiesOf(t.player.id)).length === 3);
      check('aldri fire', (await propertiesOf(t.player.id)).length <= 3);
    }

    {
      // Already at the ceiling: every single attempt is refused.
      const t = await createTestPlayer({ cash: 20000000 });
      await buyProperty(t.player.id, 'rom-i-kollektiv', 'Alfa');
      await buyProperty(t.player.id, 'liten-leilighet', 'Beta');
      await buyProperty(t.player.id, 'sentrumsleilighet', 'Gamma');
      const cashBefore = (await reload(t.player.id)).cash;

      const results = await burst(20, (i) =>
        settle(() => buyProperty(t.player.id, 'rekkehus', `Nei ${i}`)),
      );
      check('alle tjue avvises', results.every((r) => !r.ok && r.code === 'MAKS_EIENDOMMER'),
        results.map((r) => r.code).join(','));
      check('fortsatt tre', (await propertiesOf(t.player.id)).length === 3);
      check('ingenting ble trukket', (await reload(t.player.id)).cash === cashBefore);
    }

    /* ================================================================== */
    section('11. Tjue samtidige salg av samme eiendom');

    {
      const t = await createTestPlayer({ cash: 1500000 });
      const bought = await buyProperty(t.player.id, 'rekkehus', 'Kappløpet');
      const cashBefore = (await reload(t.player.id)).cash;

      const results = await burst(20, () =>
        settle(() => sellProperty(t.player.id, bought.property.id)),
      );
      const ok = results.filter((r) => r.ok);
      const missing = results.filter((r) => r.code === 'IKKE_FUNNET');

      note(`ok=${ok.length} ikke funnet=${missing.length}`);
      check('nøyaktig ett salg lykkes', ok.length === 1, `${ok.length}`);
      check('resten svarer konsistent ikke funnet', missing.length === 19, `${missing.length}`);

      const after = await reload(t.player.id);
      check('spilleren fikk betalt én gang', after.cash === cashBefore + 400000, `${after.cash}`);
      check('eiendommen er borte', (await propertiesOf(t.player.id)).length === 0);
      check(
        'nøyaktig én salgstransaksjon',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'EIENDOM_SALG' },
        })) === 1,
      );
    }

    /* ================================================================== */
    section('12. Kjøp, salg, bank og lesing samtidig');

    {
      const seedCash = 2000000;
      const t = await createTestPlayer({ cash: seedCash, bankBalance: 0 });
      const existing = await buyProperty(t.player.id, 'rekkehus', 'Fra før');

      const results = await Promise.all([
        settle(() => buyProperty(t.player.id, 'sentrumsleilighet', 'Samtidig')),
        settle(() => sellProperty(t.player.id, existing.property.id)),
        settle(() => sellProperty(t.player.id, existing.property.id)),
        post(server.base, '/spiller/bank/innskudd', { cookie: t.cookie, body: { amount: 50000 } }),
        settle(() => buyProperty(t.player.id, 'moderne-villa', 'Samtidig 2')),
        ...Array.from({ length: 6 }, () => get(server.base, '/eiendom', { cookie: t.cookie })),
      ]);

      // The bank deposit is an HTTP call too; only the property listings carry
      // `maxProperties`, so that is what separates them.
      const reads = results.filter(
        (r): r is { status: number; body: any } =>
          typeof r === 'object' &&
          r !== null &&
          'status' in r &&
          (r as { body?: { maxProperties?: number } }).body?.maxProperties !== undefined,
      );

      const after = await reload(t.player.id);
      const rows = await propertiesOf(t.player.id);
      const ledger = await prisma.transaction.findMany({ where: { playerId: t.player.id } });
      const cashDelta = ledger
        .filter((row) => row.ledger === 'CASH')
        .reduce((sum, row) => sum + row.amount, 0);

      note(`cash ${seedCash} -> ${after.cash}, bank ${after.bankBalance}, ${rows.length} eiendommer`);

      check('kontanter er aldri negative', after.cash >= 0, `${after.cash}`);
      check('banksaldoen er aldri negativ', after.bankBalance >= 0);
      check('maksgrensen holder', rows.length <= PROPERTY_TUNING.maxProperties, `${rows.length}`);
      check(
        'regnskapet forklarer hele endringen i kontanter',
        cashDelta === after.cash - seedCash,
        `${cashDelta} vs ${after.cash - seedCash}`,
      );
      check(
        'eiendommen ble solgt høyst én gang',
        ledger.filter((row) => row.type === 'EIENDOM_SALG').length <= 1,
      );
      check(
        'alle seks lesninger svarer 200 og er konsistente',
        reads.every(
          (r) =>
            r.status === 200 &&
            Array.isArray(r.body.properties) &&
            r.body.count === r.body.properties.length &&
            r.body.properties.every((p: any) => typeof p.currentValue === 'number'),
        ),
        `${reads.length} lesninger: ${reads.map((r) => r.status).join(',')}`,
      );
      check('alle seks lesningene ble fanget opp', reads.length === 6, `${reads.length}`);
      check(
        'ingen spøkelseseiendommer',
        rows.every((row) => row.playerId === t.player.id && row.purchasePrice > 0),
      );
    }

    /* ================================================================== */
    section('13. Rollback');

    {
      // A genuine PostgreSQL constraint failure, after the money has moved.
      const t = await createTestPlayer({ cash: 600000 });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "properties" ADD CONSTRAINT "properties_rollback_probe" CHECK ("name" <> 'Rullbakk')`,
      );

      try {
        const result = await settle(() => buyProperty(t.player.id, 'rekkehus', 'Rullbakk'));
        check('kjøpet feiler på databasefeilen', !result.ok, 'lyktes uventet');

        check('kontantene er rullet tilbake', (await reload(t.player.id)).cash === 600000);
        check('ingen eiendomsrad ble liggende igjen',
          (await propertiesOf(t.player.id)).length === 0);
        check(
          'ingen transaksjon ble liggende igjen',
          (await prisma.transaction.count({ where: { playerId: t.player.id } })) === 0,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "properties" DROP CONSTRAINT "properties_rollback_probe"`,
        );
      }
    }

    {
      // At the wealth ceiling the ledger refuses the credit - after the row has
      // already been deleted. The property must survive.
      const t = await createTestPlayer({ cash: 2_000_000_000 });
      const property = await prisma.property.create({
        data: {
          playerId: t.player.id,
          propertyTypeId: 'luksuseiendom',
          name: 'Taket',
          purchasePrice: 2500000,
          currentValue: 2500000,
          condition: 100,
          storageCapacity: 60,
          security: 5,
          districtId: 'regjeringskvartalet',
        },
      });

      const result = await settle(() => sellProperty(t.player.id, property.id));
      check('salget avvises', !result.ok, 'lyktes uventet');
      check('feilkoden er taket', result.code === 'TAK_NADD', result.code);

      const row = await prisma.property.findUnique({ where: { id: property.id } });
      check('eiendommen er rullet tilbake', row !== null);
      check('den er uendret', row?.name === 'Taket' && row?.currentValue === 2500000);
      check('kontantene er uendret', (await reload(t.player.id)).cash === 2_000_000_000);
      check(
        'ingen transaksjon ble liggende igjen',
        (await prisma.transaction.count({ where: { playerId: t.player.id } })) === 0,
      );
    }

    /* ================================================================== */
    section('14. Rate limiting per spiller');

    {
      const t = await createTestPlayer({ cash: 20000000 });

      const results: Array<{ status: number; body: any }> = [];
      for (let i = 0; i < 25; i += 1) {
        results.push(
          await post(server.base, '/eiendom/kjop', {
            cookie: t.cookie,
            body: { propertyTypeId: 'rom-i-kollektiv', name: `Rom ${i}` },
          }),
        );
      }

      const created = results.filter((r) => r.status === 201).length;
      const maxed = results.filter((r) => r.body?.error?.code === 'MAKS_EIENDOMMER').length;
      const limited = results.filter((r) => r.status === 429);

      note(`opprettet=${created} maksgrense=${maxed} rate-limited=${limited.length}`);
      check('nøyaktig 20 slipper gjennom', created + maxed === 20, `${created + maxed}`);
      check('resten blokkeres', limited.length === 5, `${limited.length}`);
      check(
        'meldingen er på norsk',
        limited[0]?.body?.error?.message === 'Du kjøper for raskt. Vent litt.',
        limited[0]?.body?.error?.message,
      );
      check('spillregelen holder uansett', (await propertiesOf(t.player.id)).length === 3);

      const other = await createTestPlayer({ cash: 50000 });
      const free = await post(server.base, '/eiendom/kjop', {
        cookie: other.cookie,
        body: { propertyTypeId: 'rom-i-kollektiv', name: 'Egen kvote' },
      });
      check('en annen spiller har egen kvote', free.status === 201, String(free.status));
    }

    {
      const t = await createTestPlayer({ cash: 200000 });
      const bought = await buyProperty(t.player.id, 'rom-i-kollektiv', 'Salgsgrense');

      const results: Array<{ status: number; body: any }> = [];
      for (let i = 0; i < 35; i += 1) {
        results.push(
          await post(server.base, '/eiendom/selg', {
            cookie: t.cookie,
            body: { propertyId: bought.property.id },
          }),
        );
      }

      const handled = results.filter((r) => r.status === 200 || r.status === 404).length;
      const limited = results.filter((r) => r.status === 429).length;
      note(`salg behandlet=${handled} blokkert=${limited}`);
      check('salg slipper gjennom 30', handled === 30, `${handled}`);
      check('resten blokkeres', limited === 5, `${limited}`);
      check(
        'kun ett salg ble bokført',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'EIENDOM_SALG' },
        })) === 1,
      );
    }

    /* ================================================================== */
    section('15. Ingen andre systemer er rørt');

    {
      const t = await createTestPlayer({
        cash: 1000000,
        energy: 100,
        heat: 0,
        currentDistrictId: 'sentrum',
      });
      const before = await reload(t.player.id);

      const bought = await buyProperty(t.player.id, 'rekkehus', 'Nøytral');
      await getProperty(t.player.id, bought.property.id);
      await listProperties(t.player.id);
      await sellProperty(t.player.id, bought.property.id);

      const after = await reload(t.player.id);
      check('energien er urørt', after.energy === before.energy, `${after.energy}`);
      check('heat er urørt', after.heat === before.heat);
      check('helsa er urørt', after.health === before.health);
      check('XP er urørt', after.xp === before.xp);
      check('nivået er urørt', after.level === before.level);
      check('ferdighetspoeng er urørt', after.skillPoints === before.skillPoints);
      check('spillerens distrikt er urørt', after.currentDistrictId === 'sentrum');
      check(
        'kun kjøp og salg ble bokført',
        (await prisma.transaction.count({ where: { playerId: t.player.id } })) === 2,
      );
      check(
        'ingen eiendeler ble opprettet',
        (await prisma.asset.count({ where: { playerId: t.player.id } })) === 0,
      );
      check(
        'ingen kjøretøy ble opprettet',
        (await prisma.vehicle.count({ where: { playerId: t.player.id } })) === 0,
      );
      check(
        'ingen virksomheter ble opprettet',
        (await prisma.business.count({ where: { playerId: t.player.id } })) === 0,
      );
      check(
        'tap ved salg er 20 %',
        after.cash === before.cash - 500000 + 400000,
        `${after.cash}`,
      );
    }

    /* ================================================================== */
    section('16. Sletting av spiller');

    {
      const t = await createTestPlayer({ cash: 200000 });
      await buyProperty(t.player.id, 'rom-i-kollektiv', 'Forsvinner');
      check('eiendommen finnes', (await propertiesOf(t.player.id)).length === 1);

      await prisma.player.delete({ where: { id: t.player.id } });
      check(
        'eiendommen forsvinner med spilleren',
        (await prisma.property.count({ where: { playerId: t.player.id } })) === 0,
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
