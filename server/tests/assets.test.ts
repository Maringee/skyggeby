/**
 * Integration tests for the asset system, against the real PostgreSQL database
 * and a real Express server.
 *
 * Run with `npm -w @skyggeby/server run test:assets`.
 */
import {
  ASSET_CATEGORIES,
  ASSET_TYPES,
  ASSET_TUNING,
  calculateMaintenanceDue,
  calculateSaleValue,
  findAssetType,
} from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/errors';
import { buyAsset, sellAsset } from '../src/modules/assets/asset.service';
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

async function assetsOf(playerId: string) {
  return prisma.asset.findMany({ where: { playerId } });
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1-2. Katalogen');

    {
      check('katalogen har 20 typer', ASSET_TYPES.length === 20, `${ASSET_TYPES.length}`);

      const perCategory = ASSET_CATEGORIES.map(
        (c) => ASSET_TYPES.filter((a) => a.category === c).length,
      );
      check('fem per kategori', perCategory.every((n) => n === 5), perCategory.join(','));

      const ids = ASSET_TYPES.map((a) => a.id);
      check('alle id-er er unike', new Set(ids).size === ids.length);
      check(
        'alle priser er positive heltall',
        ASSET_TYPES.every((a) => Number.isInteger(a.purchasePrice) && a.purchasePrice > 0),
      );
      check(
        'vedlikehold er aldri negativt',
        ASSET_TYPES.every((a) => a.maintenanceCostPerDay >= 0),
      );
      check(
        'synlighet er 0-100 og risiko 0-5',
        ASSET_TYPES.every(
          (a) => a.visibility >= 0 && a.visibility <= 100 && a.risk >= 0 && a.risk <= 5,
        ),
      );
      check(
        'alle har norsk navn og beskrivelse',
        ASSET_TYPES.every((a) => a.name.length > 2 && a.description.length > 10),
      );

      // Spot-check the numbers the specification named.
      const sportsbil = findAssetType('sportsbil');
      check('sportsbil koster 250 000', sportsbil?.purchasePrice === 250000);
      check('sportsbil har synlighet 75', sportsbil?.visibility === 75);
      const diamant = findAssetType('diamant');
      check('diamant koster 1 000 000', diamant?.purchasePrice === 1000000);
      check('diamant har null vedlikehold', diamant?.maintenanceCostPerDay === 0);

      const t = await createTestPlayer({ cash: 50000 });
      const res = await get(server.base, '/eiendeler/katalog', { cookie: t.cookie });
      check('katalogendepunktet svarer 200', res.status === 200, String(res.status));
      check('returnerer 20 oppføringer', res.body?.catalog?.length === 20);
      check(
        'råd-flagget er beregnet av serveren',
        res.body.catalog.find((c: any) => c.id === 'moped')?.affordable === true &&
          res.body.catalog.find((c: any) => c.id === 'sportsbil')?.affordable === false,
      );
      check(
        'kategorinavn er norske',
        res.body.catalog.find((c: any) => c.id === 'sportsbil')?.categoryLabel === 'Kjøretøy',
      );
    }

    /* ================================================================== */
    section('3-8. Kjøp');

    {
      const t = await createTestPlayer({ cash: 100000 });
      await prisma.player.update({
        where: { id: t.player.id },
        data: { currentDistrictId: 'havna' },
      });

      const res = await post(server.base, '/eiendeler/kjop', {
        cookie: t.cookie,
        body: { assetTypeId: 'sedan' },
      });

      check('kjøp svarer 201', res.status === 201, String(res.status));
      check('meldingen er norsk', /Du kjøpte sedan for/.test(res.body?.message ?? ''),
        res.body?.message);

      const after = await reload(t.player.id);
      check('serverprisen ble trukket', after.cash === 100000 - 75000, `cash=${after.cash}`);

      const rows = await assetsOf(t.player.id);
      check('eiendelen ble opprettet', rows.length === 1, `${rows.length}`);
      check('kjøpspris er serverens', rows[0]!.purchasePrice === 75000);
      check('nåverdi starter på kjøpspris', rows[0]!.currentValue === 75000);
      check('tilstand starter på 100', rows[0]!.condition === ASSET_TUNING.startCondition);
      check('status er ACTIVE', rows[0]!.status === 'ACTIVE');
      check('stedet er spillerens faktiske distrikt', rows[0]!.location === 'havna',
        rows[0]!.location);
      check('eieren er riktig', rows[0]!.playerId === t.player.id);
      check('vedlikehold kopiert fra katalogen', rows[0]!.maintenanceCostPerDay === 300);

      const tx = await prisma.transaction.findMany({ where: { playerId: t.player.id } });
      const purchase = tx.find((row) => row.type === 'EIENDEL_KJOP');
      check('transaksjon ble bokført', purchase !== undefined);
      check('beløpet er negativt og riktig', purchase?.amount === -75000, `${purchase?.amount}`);
      check('saldoen i loggen stemmer', purchase?.balanceAfter === 25000,
        `${purchase?.balanceAfter}`);
      check('beskrivelsen nevner distriktet', /Havna/.test(purchase?.description ?? ''),
        purchase?.description ?? '');

      // Without enough cash.
      const broke = await createTestPlayer({ cash: 1000 });
      const denied = await post(server.base, '/eiendeler/kjop', {
        cookie: broke.cookie,
        body: { assetTypeId: 'sportsbil' },
      });
      check('for lite penger avvises', denied.status === 400, String(denied.status));
      check('feilkoden er riktig', denied.body?.error?.code === 'IKKE_NOK_MIDLER',
        denied.body?.error?.code);
      check('feilmeldingen er norsk', /har ikke råd/.test(denied.body?.error?.message ?? ''),
        denied.body?.error?.message);
      check('ingen penger ble trukket', (await reload(broke.player.id)).cash === 1000);
      check('ingen eiendel ble opprettet', (await assetsOf(broke.player.id)).length === 0);

      // Same type twice is allowed in v1.
      const collector = await createTestPlayer({ cash: 20000 });
      await post(server.base, '/eiendeler/kjop', {
        cookie: collector.cookie,
        body: { assetTypeId: 'moped' },
      });
      await post(server.base, '/eiendeler/kjop', {
        cookie: collector.cookie,
        body: { assetTypeId: 'moped' },
      });
      check('samme type kan eies flere ganger',
        (await assetsOf(collector.player.id)).length === 2);

      // Unknown and malformed types.
      const bad = await Promise.all([
        post(server.base, '/eiendeler/kjop', { cookie: t.cookie, body: { assetTypeId: 'ubåt' } }),
        post(server.base, '/eiendeler/kjop', { cookie: t.cookie, body: { assetTypeId: '' } }),
        post(server.base, '/eiendeler/kjop', { cookie: t.cookie, body: {} }),
        post(server.base, '/eiendeler/kjop', { cookie: t.cookie, body: { assetTypeId: 42 } }),
      ]);
      check('ugyldige typer avvises', bad.every((r) => r.status === 400),
        bad.map((r) => r.status).join(','));
    }

    /* ================================================================== */
    section('9-11. Salg og verdiberegning');

    {
      check('75 000 @ 87 % gir 52 200', calculateSaleValue(75000, 87) === 52200);
      check('full tilstand gir 80 %', calculateSaleValue(250000, 100) === 200000);
      check('halv tilstand halverer', calculateSaleValue(100000, 50) === 40000);
      check('null tilstand gir 0', calculateSaleValue(100000, 0) === 0);
      check('rundes ned', calculateSaleValue(1501, 33) === Math.floor(1501 * 0.8 * 0.33));

      const t = await createTestPlayer({ cash: 100000 });
      await post(server.base, '/eiendeler/kjop', {
        cookie: t.cookie,
        body: { assetTypeId: 'sedan' },
      });
      const [asset] = await assetsOf(t.player.id);

      // Wear it to 87 % directly in the database.
      await prisma.asset.update({ where: { id: asset!.id }, data: { condition: 87 } });

      const listed = await get(server.base, '/eiendeler', { cookie: t.cookie });
      check('API oppgir salgsverdien', listed.body.assets[0].saleValue === 52200,
        String(listed.body.assets[0].saleValue));

      const cashBefore = (await reload(t.player.id)).cash;
      const res = await post(server.base, '/eiendeler/selg', {
        cookie: t.cookie,
        body: { assetId: asset!.id },
      });

      check('salg svarer 200', res.status === 200, String(res.status));
      check('salgsverdien er serverens', res.body?.saleValue === 52200, String(res.body?.saleValue));
      check('meldingen er norsk', /Du solgte sedan for/.test(res.body?.message ?? ''),
        res.body?.message);

      const after = await reload(t.player.id);
      check('pengene ble kreditert', after.cash === cashBefore + 52200, `cash=${after.cash}`);
      check('eiendelen er borte', (await assetsOf(t.player.id)).length === 0);

      const sale = await prisma.transaction.findFirst({
        where: { playerId: t.player.id, type: 'EIENDEL_SALG' },
      });
      check('salget ble bokført', sale?.amount === 52200, `${sale?.amount}`);

      // Condition genuinely changes the payout.
      const a = await createTestPlayer({ cash: 100000 });
      const b = await createTestPlayer({ cash: 100000 });
      await buyAsset(a.player.id, 'sedan');
      await buyAsset(b.player.id, 'sedan');
      const [assetA] = await assetsOf(a.player.id);
      const [assetB] = await assetsOf(b.player.id);
      await prisma.asset.update({ where: { id: assetB!.id }, data: { condition: 40 } });

      const saleA = await sellAsset(a.player.id, assetA!.id);
      const saleB = await sellAsset(b.player.id, assetB!.id);
      note(`100 % gir ${saleA.saleValue} kr, 40 % gir ${saleB.saleValue} kr`);
      check('bedre tilstand gir mer', saleA.saleValue > saleB.saleValue);
      check('40 % gir nøyaktig 24 000', saleB.saleValue === 24000, `${saleB.saleValue}`);
    }

    /* ================================================================== */
    section('12-14. Statusregler og eierskap');

    {
      const t = await createTestPlayer({ cash: 100000 });
      await buyAsset(t.player.id, 'bruktbil');
      await buyAsset(t.player.id, 'moped');
      const rows = await assetsOf(t.player.id);

      await prisma.asset.update({ where: { id: rows[0]!.id }, data: { status: 'SEIZED' } });
      await prisma.asset.update({ where: { id: rows[1]!.id }, data: { status: 'DAMAGED' } });

      const seized = await post(server.base, '/eiendeler/selg', {
        cookie: t.cookie,
        body: { assetId: rows[0]!.id },
      });
      const damaged = await post(server.base, '/eiendeler/selg', {
        cookie: t.cookie,
        body: { assetId: rows[1]!.id },
      });

      check('beslaglagt kan ikke selges', seized.status === 400, String(seized.status));
      check('feilmeldingen forklarer hvorfor',
        /Beslaglagte eiendeler kan ikke selges/.test(seized.body?.error?.message ?? ''),
        seized.body?.error?.message);
      check('skadet kan ikke selges', damaged.status === 400, String(damaged.status));
      check('skademeldingen er norsk',
        /reparasjon/.test(damaged.body?.error?.message ?? ''),
        damaged.body?.error?.message);
      check('begge ligger fortsatt der', (await assetsOf(t.player.id)).length === 2);
      check('ingen penger kom inn', (await reload(t.player.id)).cash === 100000 - 35000 - 8000);

      // STORED can be sold.
      const storedOwner = await createTestPlayer({ cash: 20000 });
      await buyAsset(storedOwner.player.id, 'moped');
      const [storedAsset] = await assetsOf(storedOwner.player.id);
      await prisma.asset.update({ where: { id: storedAsset!.id }, data: { status: 'STORED' } });
      const storedSale = await settle(() => sellAsset(storedOwner.player.id, storedAsset!.id));
      check('lagret kan selges', storedSale.ok, storedSale.code);

      // Another player's asset.
      const victim = await createTestPlayer({ cash: 100000 });
      await buyAsset(victim.player.id, 'sedan');
      const [victimAsset] = await assetsOf(victim.player.id);
      const victimCashBefore = (await reload(victim.player.id)).cash;

      const thief = await createTestPlayer({ cash: 0 });
      const stolen = await post(server.base, '/eiendeler/selg', {
        cookie: thief.cookie,
        body: { assetId: victimAsset!.id },
      });

      check('andres eiendel gir 404', stolen.status === 404, String(stolen.status));
      check('meldingen røper ingenting',
        stolen.body?.error?.message === 'Fant ikke denne eiendelen.',
        stolen.body?.error?.message);
      check('offeret beholder eiendelen', (await assetsOf(victim.player.id)).length === 1);
      check('offerets økonomi er urørt',
        (await reload(victim.player.id)).cash === victimCashBefore);
      check('tyven fikk ingenting', (await reload(thief.player.id)).cash === 0);
    }

    /* ================================================================== */
    section('15. Samtidige salg av samme eiendel');

    {
      const t = await createTestPlayer({ cash: 100000 });
      await buyAsset(t.player.id, 'sedan');
      const [asset] = await assetsOf(t.player.id);
      const cashBefore = (await reload(t.player.id)).cash;

      const results = await burst(8, () => settle(() => sellAsset(t.player.id, asset!.id)));
      const ok = results.filter((r) => r.ok);
      const gone = results.filter((r) => r.code === 'IKKE_FUNNET' || r.code === 'ALLEREDE_SOLGT');

      note(`ok=${ok.length} avvist=${gone.length}`);
      check('nøyaktig ett salg lykkes', ok.length === 1, `${ok.length}`);
      check('resten avvises rent', gone.length === 7, `${gone.length}`);

      const after = await reload(t.player.id);
      check('nøyaktig én utbetaling', after.cash === cashBefore + 60000, `cash=${after.cash}`);
      check('eiendelen finnes ikke etterpå', (await assetsOf(t.player.id)).length === 0);

      const sales = await prisma.transaction.count({
        where: { playerId: t.player.id, type: 'EIENDEL_SALG' },
      });
      check('kun én salgstransaksjon', sales === 1, `${sales}`);
    }

    /* ================================================================== */
    section('16. Tjue samtidige kjøp med råd til ett');

    {
      // Enough for exactly one sedan.
      const t = await createTestPlayer({ cash: 80000 });

      const results = await burst(20, () => settle(() => buyAsset(t.player.id, 'sedan')));
      const ok = results.filter((r) => r.ok);
      const denied = results.filter((r) => r.code === 'IKKE_NOK_MIDLER');

      note(`ok=${ok.length} avvist=${denied.length}`);
      check('nøyaktig ett kjøp lykkes', ok.length === 1, `${ok.length}`);
      check('resten avvises for lite penger', denied.length === 19, `${denied.length}`);

      const after = await reload(t.player.id);
      check('kontanter blir aldri negative', after.cash >= 0, `cash=${after.cash}`);
      check('nøyaktig én betaling', after.cash === 5000, `cash=${after.cash}`);
      check('nøyaktig én eiendel', (await assetsOf(t.player.id)).length === 1);

      const purchases = await prisma.transaction.count({
        where: { playerId: t.player.id, type: 'EIENDEL_KJOP' },
      });
      check('ingen gratis eiendeler', purchases === 1, `${purchases}`);
    }

    /* ================================================================== */
    section('17. Samtidig kjøp og salg');

    {
      const seedCash = 80000;
      const t = await createTestPlayer({ cash: seedCash });
      await buyAsset(t.player.id, 'moped');
      const [moped] = await assetsOf(t.player.id);
      const cashBefore = (await reload(t.player.id)).cash;

      const results = await Promise.all([
        settle(() => buyAsset(t.player.id, 'bruktbil')),
        settle(() => sellAsset(t.player.id, moped!.id)),
        settle(() => buyAsset(t.player.id, 'laseverktoy')),
        settle(() => sellAsset(t.player.id, moped!.id)),
      ]);

      const after = await reload(t.player.id);
      const rows = await assetsOf(t.player.id);
      const ledger = await prisma.transaction.findMany({ where: { playerId: t.player.id } });
      const ledgerSum = ledger.reduce((sum, row) => sum + row.amount, 0);

      note(
        `cash ${cashBefore} -> ${after.cash}, ${rows.length} eiendeler, ` +
          `${results.filter((r) => r.ok).length} operasjoner lyktes`,
      );

      check('kontanter er aldri negative', after.cash >= 0, `${after.cash}`);
      check('mopeden ble solgt høyst én gang',
        results.filter((r) => r.ok && 'saleValue' in (r.value as object)).length <= 1);
      check(
        'regnskapet forklarer hele endringen i saldo',
        ledgerSum === after.cash - seedCash,
        `${ledgerSum} vs ${after.cash - seedCash}`,
      );
      check('ingen spøkelseseiendeler',
        rows.every((row) => row.purchasePrice > 0 && row.playerId === t.player.id));
    }

    /* ================================================================== */
    section('18. Rollback');

    {
      // Buying while at the wealth ceiling is fine, but selling would breach it:
      // the ledger aborts after the asset row has already been deleted.
      const t = await createTestPlayer({ cash: 2_000_000_000 });
      await prisma.asset.create({
        data: {
          playerId: t.player.id,
          assetTypeId: 'diamant',
          name: 'Diamant',
          category: 'VALUABLE',
          purchasePrice: 1000000,
          currentValue: 1000000,
          condition: 100,
          maintenanceCostPerDay: 0,
          visibility: 30,
          risk: 4,
          location: 'sentrum',
          status: 'ACTIVE',
        },
      });

      const before = await reload(t.player.id);
      const [diamond] = await assetsOf(t.player.id);
      const result = await settle(() => sellAsset(t.player.id, diamond!.id));

      check('salget avvises', !result.ok, 'lyktes uventet');
      check('feilkoden er taket', result.code === 'TAK_NADD', result.code);

      const after = await reload(t.player.id);
      check('kontanter er uendret', after.cash === before.cash, `${after.cash}`);
      check('eiendelen er rullet tilbake', (await assetsOf(t.player.id)).length === 1);
      check('ingen transaksjon ble liggende igjen',
        (await prisma.transaction.count({ where: { playerId: t.player.id } })) === 0);
    }

    /* ================================================================== */
    section('19. Manipulerte klientfelter');

    {
      const t = await createTestPlayer({ cash: 300000 });
      await prisma.player.update({
        where: { id: t.player.id },
        data: { currentDistrictId: 'blokkene' },
      });

      const res = await post(server.base, '/eiendeler/kjop', {
        cookie: t.cookie,
        body: {
          assetTypeId: 'sportsbil',
          price: 1,
          purchasePrice: 1,
          currentValue: 999999999,
          condition: 100,
          location: 'regjeringskvartalet',
          playerId: 'noen-andre',
          category: 'VALUABLE',
          name: 'Gratis sportsbil',
          status: 'SEIZED',
          maintenanceCostPerDay: 0,
          visibility: 0,
          risk: 0,
        },
      });

      check('kjøpet behandles normalt', res.status === 201, String(res.status));

      const [row] = await assetsOf(t.player.id);
      const after = await reload(t.player.id);

      check('serverprisen ble trukket, ikke 1 kr', after.cash === 300000 - 250000,
        `cash=${after.cash}`);
      check('kjøpspris er katalogens', row!.purchasePrice === 250000, `${row!.purchasePrice}`);
      check('nåverdi er ikke 999 999 999', row!.currentValue === 250000, `${row!.currentValue}`);
      check('stedet kommer fra databasen', row!.location === 'blokkene', row!.location);
      check('eieren er den innloggede', row!.playerId === t.player.id);
      check('navnet er katalogens', row!.name === 'Sportsbil', row!.name);
      check('kategorien er katalogens', row!.category === 'VEHICLE', row!.category);
      check('statusen er ACTIVE', row!.status === 'ACTIVE', row!.status);
      check('vedlikehold er katalogens', row!.maintenanceCostPerDay === 900);
      check('synlighet og risiko er katalogens',
        row!.visibility === 75 && row!.risk === 5);

      // The same on the sell endpoint.
      const sellRes = await post(server.base, '/eiendeler/selg', {
        cookie: t.cookie,
        body: {
          assetId: row!.id,
          saleValue: 999999999,
          price: 999999999,
          condition: 100,
        },
      });
      check('salget behandles normalt', sellRes.status === 200, String(sellRes.status));
      check('salgsverdien er serverens', sellRes.body?.saleValue === 200000,
        String(sellRes.body?.saleValue));
      check('kontanter økte med serverens beløp',
        (await reload(t.player.id)).cash === 50000 + 200000);
    }

    /* ================================================================== */
    section('20. API og tilgang');

    {
      const anonList = await get(server.base, '/eiendeler');
      const anonCatalog = await get(server.base, '/eiendeler/katalog');
      const anonBuy = await post(server.base, '/eiendeler/kjop', {
        body: { assetTypeId: 'moped' },
      });
      check('liste uten sesjon gir 401', anonList.status === 401, String(anonList.status));
      check('katalog uten sesjon gir 401', anonCatalog.status === 401,
        String(anonCatalog.status));
      check('kjøp uten sesjon gir 401', anonBuy.status === 401, String(anonBuy.status));

      const t = await createTestPlayer({ cash: 50000 });
      await buyAsset(t.player.id, 'moped');
      const res = await get(server.base, '/eiendeler', { cookie: t.cookie });
      const assetJson = JSON.stringify(res.body.assets);

      check('svaret er 200', res.status === 200, String(res.status));
      check('interne felter lekker ikke fra eiendelene',
        !/maintenancePaidAt|updatedAt|playerId/.test(assetJson),
        assetJson.slice(0, 120));
      check('katalogsvaret lekker heller ikke',
        !/maintenancePaidAt|playerId/.test(
          JSON.stringify((await get(server.base, '/eiendeler/katalog', { cookie: t.cookie }))
            .body.catalog),
        ));
      check('eiendelen har norske etiketter',
        res.body.assets[0].categoryLabel === 'Kjøretøy' &&
          res.body.assets[0].statusLabel === 'Aktiv');
      check('stedsnavnet er norsk', typeof res.body.assets[0].locationName === 'string');
      check('summene beregnes av serveren',
        res.body.totalValue === 8000 && res.body.count === 1,
        `${res.body.totalValue}/${res.body.count}`);
      check('salgsverdi følger med', res.body.assets[0].saleValue === 6400);

      const missing = await post(server.base, '/eiendeler/selg', {
        cookie: t.cookie,
        body: { assetId: 'finnes-ikke' },
      });
      check('ukjent id gir 404', missing.status === 404, String(missing.status));
    }

    /* ================================================================== */
    section('21. Vedlikeholdsberegning');

    {
      const now = new Date();
      check(
        '900 kr/dag i tre dager gir 2 700',
        calculateMaintenanceDue(
          {
            maintenanceCostPerDay: 900,
            maintenancePaidAt: new Date(now.getTime() - 3 * 86400000),
          },
          now,
        ) === 2700,
      );
      check(
        'null kostnad gir null',
        calculateMaintenanceDue(
          { maintenanceCostPerDay: 0, maintenancePaidAt: new Date(0) },
          now,
        ) === 0,
      );
      check(
        'framtidig tidsstempel gir null',
        calculateMaintenanceDue(
          {
            maintenanceCostPerDay: 100,
            maintenancePaidAt: new Date(now.getTime() + 86400000),
          },
          now,
        ) === 0,
      );

      // Nothing charges it: buying an asset and waiting costs nothing.
      const t = await createTestPlayer({ cash: 300000 });
      await buyAsset(t.player.id, 'sportsbil');
      const cashAfterBuy = (await reload(t.player.id)).cash;
      await prisma.asset.updateMany({
        where: { playerId: t.player.id },
        data: { maintenancePaidAt: new Date(Date.now() - 30 * 86400000) },
      });
      await get(server.base, '/eiendeler', { cookie: t.cookie });
      check('vedlikehold trekkes ikke automatisk i v1',
        (await reload(t.player.id)).cash === cashAfterBuy);
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
