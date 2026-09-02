/**
 * Integration tests for the vehicle system, against the real PostgreSQL
 * database and a real Express server.
 *
 * The rule the whole suite exists to prove: a player's district and a
 * vehicle's district are two separate, server-owned states. Moving yourself
 * never moves a car, moving a car never moves you, and nothing a client sends
 * can bend either.
 *
 * Run with `npm -w @skyggeby/server run test:vehicles`.
 */
import {
  VEHICLE_TUNING,
  VEHICLE_TYPES,
  calculateSaleValue,
  findAssetType,
  findVehicleType,
  validateVehicleCatalogue,
} from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/errors';
import { buyAsset, sellAsset } from '../src/modules/assets/asset.service';
import {
  activateVehicle,
  buyVehicle,
  listVehicles,
  moveVehicle,
  parkVehicle,
  sellVehicle,
} from '../src/modules/vehicles/vehicle.service';
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

async function vehiclesOf(playerId: string) {
  return prisma.vehicle.findMany({ where: { playerId }, orderBy: { createdAt: 'asc' } });
}

async function assetsOf(playerId: string) {
  return prisma.asset.findMany({ where: { playerId } });
}

/** Moves the player without touching any vehicle, the way the city does. */
async function standIn(playerId: string, districtId: string) {
  await prisma.player.update({
    where: { id: playerId },
    data: { currentDistrictId: districtId },
  });
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1. Katalogen');

    {
      check('katalogen har fem kjøretøy', VEHICLE_TYPES.length === 5, `${VEHICLE_TYPES.length}`);

      const ids = VEHICLE_TYPES.map((v) => v.id);
      check('alle id-er er unike', new Set(ids).size === ids.length);
      check(
        'katalogen er de fem forventede typene',
        JSON.stringify(ids) ===
          JSON.stringify(['gammel-sykkel', 'moped', 'bruktbil', 'sedan', 'sportsbil']),
        ids.join(','),
      );

      // Prices are the asset catalogue's, not a second copy.
      const expected: Record<string, number> = {
        'gammel-sykkel': 1500,
        moped: 8000,
        bruktbil: 35000,
        sedan: 75000,
        sportsbil: 250000,
      };
      check(
        'prisene er eiendelskatalogens',
        VEHICLE_TYPES.every(
          (v) =>
            v.purchasePrice === expected[v.id] &&
            v.purchasePrice === findAssetType(v.id)?.purchasePrice,
        ),
        VEHICLE_TYPES.map((v) => `${v.id}=${v.purchasePrice}`).join(','),
      );
      check(
        'alle er i kjøretøykategorien',
        VEHICLE_TYPES.every((v) => v.category === 'VEHICLE'),
      );
      check('ingen kjøretøy kan bæres', VEHICLE_TYPES.every((v) => !v.inventoryEligible));

      const problems = validateVehicleCatalogue();
      check('katalogvalideringen finner ingen feil', problems.length === 0, problems.join('; '));
      check('ukjent type gir undefined', findVehicleType('helikopter') === undefined);
      check('en eiendel som ikke er kjøretøy er ikke i katalogen',
        findVehicleType('laptop') === undefined);

      const t = await createTestPlayer({ cash: 50000 });
      const res = await get(server.base, '/kjoretoy/katalog', { cookie: t.cookie });
      check('katalogendepunktet svarer 200', res.status === 200, String(res.status));
      check('den har fem oppføringer', res.body?.catalog?.length === 5);
      check('maksgrensen oppgis', res.body?.maxVehicles === 5, `${res.body?.maxVehicles}`);
      check(
        'råd-flagget beregnes av serveren',
        res.body.catalog.find((c: any) => c.id === 'moped')?.affordable === true &&
          res.body.catalog.find((c: any) => c.id === 'sportsbil')?.affordable === false,
      );
      check(
        'risikoetiketten er norsk',
        res.body.catalog.find((c: any) => c.id === 'sportsbil')?.riskLabel === 'Svært høy',
        res.body.catalog.find((c: any) => c.id === 'sportsbil')?.riskLabel,
      );
    }

    /* ================================================================== */
    section('2. Kjøp');

    {
      const t = await createTestPlayer({ cash: 100000, currentDistrictId: 'havna' });

      const res = await post(server.base, '/kjoretoy/kjop', {
        cookie: t.cookie,
        body: { vehicleTypeId: 'sedan', name: '  Arbeids   bilen  ' },
      });

      check('kjøp svarer 201', res.status === 201, String(res.status));
      check('meldingen er norsk', /Du kjøpte sedan for/.test(res.body?.message ?? ''),
        res.body?.message);

      const after = await reload(t.player.id);
      check('serverprisen ble trukket', after.cash === 100000 - 75000, `cash=${after.cash}`);

      const rows = await vehiclesOf(t.player.id);
      check('kjøretøyet ble registrert', rows.length === 1, `${rows.length}`);
      check('navnet ble trimmet og normalisert', rows[0]!.name === 'Arbeids bilen',
        `"${rows[0]!.name}"`);
      check('typen er katalogens', rows[0]!.vehicleTypeId === 'sedan');
      check('det står der spilleren står', rows[0]!.locationDistrictId === 'havna',
        rows[0]!.locationDistrictId);
      check('det starter parkert', rows[0]!.isActive === false);

      const assets = await assetsOf(t.player.id);
      check('en eiendel ble opprettet ved siden av', assets.length === 1);
      check('eiendelen holder prisen', assets[0]!.purchasePrice === 75000);
      check('eiendelen holder tilstanden', assets[0]!.condition === 100);
      check('kjøretøyet peker på eiendelen', rows[0]!.assetId === assets[0]!.id);

      const ledger = await prisma.transaction.findMany({ where: { playerId: t.player.id } });
      check('kjøpet ble bokført én gang', ledger.length === 1, `${ledger.length}`);
      check('typen er eiendelskjøp', ledger[0]?.type === 'EIENDEL_KJOP', ledger[0]?.type);
      check('beløpet er negativt og korrekt', ledger[0]?.amount === -75000);

      const dto = res.body.vehicle;
      check('DTO-en har spillerens navn', dto?.name === 'Arbeids bilen');
      check('DTO-en har katalogtypen', dto?.typeName === 'Sedan');
      check('DTO-en har distriktsnavn', dto?.districtName === 'Havna');
      check('DTO-en er parkert', dto?.isActive === false && dto?.statusLabel === 'Parkert');
      check('DTO-en er innen rekkevidde', dto?.reachable === true);
      check('DTO-en har salgsverdi', dto?.saleValue === calculateSaleValue(75000, 100));
    }

    {
      const poor = await createTestPlayer({ cash: 74999 });
      const denied = await settle(() => buyVehicle(poor.player.id, 'sedan', 'For dyr'));
      check('kjøp uten nok kontanter avvises', !denied.ok, 'lyktes uventet');
      check('feilkoden er midler', denied.code === 'IKKE_NOK_MIDLER', denied.code);
      check('ingen kjøretøyrad', (await vehiclesOf(poor.player.id)).length === 0);
      check('ingen eiendelsrad', (await assetsOf(poor.player.id)).length === 0);
      check(
        'ingen transaksjon',
        (await prisma.transaction.count({ where: { playerId: poor.player.id } })) === 0,
      );
    }

    /* ================================================================== */
    section('3. Navn');

    {
      const t = await createTestPlayer({ cash: 200000 });

      const cases: Array<[string, unknown, RegExp]> = [
        ['for kort navn', { vehicleTypeId: 'moped', name: 'ab' }, /minst 3 tegn/],
        ['for langt navn', { vehicleTypeId: 'moped', name: 'x'.repeat(33) }, /maks 32 tegn/],
        ['tomt navn', { vehicleTypeId: 'moped', name: '' }, /minst 3 tegn/],
        ['navn med bare mellomrom', { vehicleTypeId: 'moped', name: '     ' }, /minst 3 tegn/],
        ['manglende navn', { vehicleTypeId: 'moped' }, /navn/i],
        ['ukjent type', { vehicleTypeId: 'helikopter', name: 'Luftbilen' }, /Ukjent kjøretøy/],
        ['eiendel som ikke er kjøretøy', { vehicleTypeId: 'laptop', name: 'Datamaskinen' },
          /Ukjent kjøretøy/],
      ];

      for (const [name, body, pattern] of cases) {
        const res = await post(server.base, '/kjoretoy/kjop', { cookie: t.cookie, body });
        check(`${name} avvises`, res.status === 400, String(res.status));
        check(
          `${name}: meldingen er norsk`,
          pattern.test(res.body?.error?.message ?? ''),
          res.body?.error?.message,
        );
      }

      check('ingenting ble opprettet', (await vehiclesOf(t.player.id)).length === 0);
      check('ingenting ble trukket', (await reload(t.player.id)).cash === 200000);

      // Text that looks like an attack is text.
      const nasty = await post(server.base, '/kjoretoy/kjop', {
        cookie: t.cookie,
        body: { vehicleTypeId: 'moped', name: "<script>alert('x')</script>" },
      });
      check('skadelig utseende navn lagres som tekst', nasty.status === 201, String(nasty.status));
      check(
        'og returneres uendret',
        nasty.body?.vehicle?.name === "<script>alert('x')</script>",
        nasty.body?.vehicle?.name,
      );

      const sql = await post(server.base, '/kjoretoy/kjop', {
        cookie: t.cookie,
        body: { vehicleTypeId: 'moped', name: "'; DROP TABLE vehicles; --" },
      });
      check('SQL-lignende navn håndteres trygt', sql.status === 201, String(sql.status));
      check('tabellen står fortsatt', (await vehiclesOf(t.player.id)).length === 2);
    }

    /* ================================================================== */
    section('4. Maks fem kjøretøy');

    {
      const t = await createTestPlayer({ cash: 200000 });
      for (let i = 1; i <= VEHICLE_TUNING.maxVehicles; i += 1) {
        await buyVehicle(t.player.id, 'moped', `Moped ${i}`);
      }

      check('spilleren har fem', (await vehiclesOf(t.player.id)).length === 5);

      const cashBefore = (await reload(t.player.id)).cash;
      const sixth = await settle(() => buyVehicle(t.player.id, 'moped', 'Moped 6'));
      check('den sjette avvises', !sixth.ok, 'lyktes uventet');
      check('feilkoden er maksgrensen', sixth.code === 'MAKS_KJORETOY', sixth.code);
      check('fortsatt fem', (await vehiclesOf(t.player.id)).length === 5);
      check('ingenting ble trukket', (await reload(t.player.id)).cash === cashBefore);

      // The ceiling is not bypassable through the asset catalogue either.
      const throughAssets = await settle(() => buyAsset(t.player.id, 'moped'));
      check('eiendelskatalogen omgår ikke grensen', !throughAssets.ok, 'lyktes uventet');
      check('samme feilkode', throughAssets.code === 'MAKS_KJORETOY', throughAssets.code);
      check('fortsatt fem kjøretøy', (await vehiclesOf(t.player.id)).length === 5);
      check('og fem eiendeler', (await assetsOf(t.player.id)).length === 5);
    }

    /* ================================================================== */
    section('5. Kjøp gjennom eiendelskatalogen registrerer kjøretøyet');

    {
      const t = await createTestPlayer({ cash: 50000, currentDistrictId: 'neon' });

      const res = await post(server.base, '/eiendeler/kjop', {
        cookie: t.cookie,
        body: { assetTypeId: 'moped' },
      });
      check('eiendelskjøp svarer fortsatt 201', res.status === 201, String(res.status));

      const rows = await vehiclesOf(t.player.id);
      check('kjøretøyet ble registrert', rows.length === 1, `${rows.length}`);
      check('navnet er katalogens', rows[0]!.name === 'Moped', rows[0]!.name);
      check('det står i spillerens distrikt', rows[0]!.locationDistrictId === 'neon');
      check('det er parkert', rows[0]!.isActive === false);

      // Non-vehicles are untouched by all of this.
      await post(server.base, '/eiendeler/kjop', {
        cookie: t.cookie,
        body: { assetTypeId: 'laptop' },
      });
      check('en laptop blir ikke et kjøretøy', (await vehiclesOf(t.player.id)).length === 1);
      check('men den blir en eiendel', (await assetsOf(t.player.id)).length === 2);
    }

    /* ================================================================== */
    section('6. Aktivering');

    {
      const t = await createTestPlayer({ cash: 200000, currentDistrictId: 'sentrum' });
      const first = await buyVehicle(t.player.id, 'moped', 'Første');
      const second = await buyVehicle(t.player.id, 'bruktbil', 'Andre');

      const res = await post(server.base, '/kjoretoy/aktiver', {
        cookie: t.cookie,
        body: { vehicleId: first.vehicle.id },
      });
      check('aktivering svarer 200', res.status === 200, String(res.status));
      check('meldingen er norsk', /er nå aktivt kjøretøy/.test(res.body?.message ?? ''),
        res.body?.message);
      check('DTO-en er aktiv', res.body?.vehicle?.isActive === true);
      check('etiketten er norsk', res.body?.vehicle?.statusLabel === 'Aktiv');
      check('svaret peker ut det aktive', res.body?.active?.id === first.vehicle.id);

      const again = await post(server.base, '/kjoretoy/aktiver', {
        cookie: t.cookie,
        body: { vehicleId: first.vehicle.id },
      });
      check('å aktivere det samme igjen svarer 200', again.status === 200);
      check('den sier at det allerede er aktivt',
        /allerede aktivt/.test(again.body?.message ?? ''), again.body?.message);

      // Activating the second parks the first, atomically.
      await post(server.base, '/kjoretoy/aktiver', {
        cookie: t.cookie,
        body: { vehicleId: second.vehicle.id },
      });
      const rows = await vehiclesOf(t.player.id);
      check('nøyaktig ett er aktivt', rows.filter((v) => v.isActive).length === 1);
      check('det er det nyeste', rows.find((v) => v.isActive)?.id === second.vehicle.id);

      // A car in another district cannot be driven from here.
      await moveVehicle(t.player.id, second.vehicle.id, 'neon');
      await parkVehicle(t.player.id, second.vehicle.id);
      const far = await post(server.base, '/kjoretoy/aktiver', {
        cookie: t.cookie,
        body: { vehicleId: second.vehicle.id },
      });
      check('kjøretøy i annet distrikt kan ikke aktiveres', far.status === 400,
        String(far.status));
      check('feilkoden er distriktet', far.body?.error?.code === 'ANNET_DISTRIKT',
        far.body?.error?.code);
      check(
        'meldingen sier hvor det står',
        /står i et annet distrikt/.test(far.body?.error?.message ?? '') &&
          /Neon/.test(far.body?.error?.message ?? ''),
        far.body?.error?.message,
      );
      check('det er fortsatt parkert',
        (await prisma.vehicle.findUniqueOrThrow({ where: { id: second.vehicle.id } })).isActive ===
          false);
    }

    /* ================================================================== */
    section('7. Parkering');

    {
      const t = await createTestPlayer({ cash: 50000 });
      const bought = await buyVehicle(t.player.id, 'moped', 'Parkeringen');
      await activateVehicle(t.player.id, bought.vehicle.id);

      const res = await post(server.base, '/kjoretoy/park', {
        cookie: t.cookie,
        body: { vehicleId: bought.vehicle.id },
      });
      check('parkering svarer 200', res.status === 200, String(res.status));
      check('kjøretøyet er parkert', res.body?.vehicle?.isActive === false);
      check('spilleren står uten aktivt kjøretøy', res.body?.active === null);

      const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: bought.vehicle.id } });
      check('parkering flytter ingenting', row.locationDistrictId === 'sentrum',
        row.locationDistrictId);

      const twice = await post(server.base, '/kjoretoy/park', {
        cookie: t.cookie,
        body: { vehicleId: bought.vehicle.id },
      });
      check('parkering to ganger svarer 200', twice.status === 200);
      check('den sier at det allerede sto parkert',
        /allerede parkert/.test(twice.body?.message ?? ''), twice.body?.message);
    }

    /* ================================================================== */
    section('8. Flytting - kjøretøyet reiser, ikke spilleren');

    {
      const t = await createTestPlayer({ cash: 200000, currentDistrictId: 'blokkene' });
      const bought = await buyVehicle(t.player.id, 'sedan', 'Sedanen');

      const parked = await post(server.base, '/kjoretoy/flytt', {
        cookie: t.cookie,
        body: { vehicleId: bought.vehicle.id, destinationDistrictId: 'neon' },
      });
      check('parkert kjøretøy kan ikke kjøres', parked.status === 400, String(parked.status));
      check('feilkoden sier det', parked.body?.error?.code === 'IKKE_AKTIVT',
        parked.body?.error?.code);

      await activateVehicle(t.player.id, bought.vehicle.id);

      const res = await post(server.base, '/kjoretoy/flytt', {
        cookie: t.cookie,
        body: { vehicleId: bought.vehicle.id, destinationDistrictId: 'neon' },
      });
      check('flytting svarer 200', res.status === 200, String(res.status));
      check(
        'meldingen forklarer geografien',
        /står nå i Neon/.test(res.body?.message ?? '') &&
          /fortsatt i Blokkene/.test(res.body?.message ?? ''),
        res.body?.message,
      );

      const player = await reload(t.player.id);
      const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: bought.vehicle.id } });
      check('kjøretøyet står i Neon', row.locationDistrictId === 'neon', row.locationDistrictId);
      check('spilleren står fortsatt i Blokkene', player.currentDistrictId === 'blokkene',
        player.currentDistrictId);
      check('kjøretøyet er fortsatt aktivt', row.isActive === true);
      check('DTO-en sier at det ikke er innen rekkevidde', res.body?.vehicle?.reachable === false);
      check(
        'og forklarer hvorfor på norsk',
        res.body?.vehicle?.blockedText === 'Kjøretøyet står i et annet distrikt.',
        res.body?.vehicle?.blockedText,
      );

      // Standing somewhere else, the car cannot be driven again.
      const stranded = await post(server.base, '/kjoretoy/flytt', {
        cookie: t.cookie,
        body: { vehicleId: bought.vehicle.id, destinationDistrictId: 'havna' },
      });
      check('kjøretøy i annet distrikt kan ikke kjøres', stranded.status === 400,
        String(stranded.status));
      check('feilkoden er distriktet', stranded.body?.error?.code === 'ANNET_DISTRIKT');
      check(
        'det står fremdeles i Neon',
        (await prisma.vehicle.findUniqueOrThrow({ where: { id: bought.vehicle.id } }))
          .locationDistrictId === 'neon',
      );

      // Follow it, and it works again.
      await standIn(t.player.id, 'neon');
      const back = await post(server.base, '/kjoretoy/flytt', {
        cookie: t.cookie,
        body: { vehicleId: bought.vehicle.id, destinationDistrictId: 'blokkene' },
      });
      check('etter at spilleren har fulgt etter går det fint', back.status === 200,
        String(back.status));
      check(
        'kjøretøyet er tilbake i Blokkene',
        (await prisma.vehicle.findUniqueOrThrow({ where: { id: bought.vehicle.id } }))
          .locationDistrictId === 'blokkene',
      );
      check(
        'spilleren står fortsatt i Neon',
        (await reload(t.player.id)).currentDistrictId === 'neon',
      );
    }

    {
      const t = await createTestPlayer({ cash: 50000, currentDistrictId: 'sentrum' });
      const bought = await buyVehicle(t.player.id, 'moped', 'Destinasjoner');
      await activateVehicle(t.player.id, bought.vehicle.id);

      for (const destination of ['finnes-ikke', '', 'SENTRUM', '../havna', 'neon;drop']) {
        const res = await post(server.base, '/kjoretoy/flytt', {
          cookie: t.cookie,
          body: { vehicleId: bought.vehicle.id, destinationDistrictId: destination },
        });
        check(`ugyldig destinasjon "${destination}" avvises`, res.status === 400,
          String(res.status));
      }

      const same = await post(server.base, '/kjoretoy/flytt', {
        cookie: t.cookie,
        body: { vehicleId: bought.vehicle.id, destinationDistrictId: 'sentrum' },
      });
      check('å kjøre dit det allerede står avvises', same.status === 400, String(same.status));
      check('feilkoden sier det', same.body?.error?.code === 'ALLEREDE_DER',
        same.body?.error?.code);

      check(
        'kjøretøyet står urørt',
        (await prisma.vehicle.findUniqueOrThrow({ where: { id: bought.vehicle.id } }))
          .locationDistrictId === 'sentrum',
      );
    }

    /* ================================================================== */
    section('9. Byflytting rører ikke kjøretøyet');

    {
      const t = await createTestPlayer({ cash: 50000, currentDistrictId: 'sentrum', energy: 100 });
      const bought = await buyVehicle(t.player.id, 'moped', 'Blir stående');
      await activateVehicle(t.player.id, bought.vehicle.id);

      const moved = await post(server.base, '/by/flytt', {
        cookie: t.cookie,
        body: { districtId: 'havna' },
      });
      check('spilleren flytter seg', moved.status === 200, String(moved.status));

      const player = await reload(t.player.id);
      const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: bought.vehicle.id } });
      check('spilleren er i Havna', player.currentDistrictId === 'havna');
      check('kjøretøyet ble ikke teleportert', row.locationDistrictId === 'sentrum',
        row.locationDistrictId);
      check('det er fortsatt aktivt', row.isActive === true);

      const list = await get(server.base, '/kjoretoy', { cookie: t.cookie });
      check('lista viser spillerens distrikt', list.body?.playerDistrictName === 'Havna');
      check('og kjøretøyets eget', list.body?.vehicles?.[0]?.districtName === 'Sentrum');
      check('og at det er utenfor rekkevidde', list.body?.vehicles?.[0]?.reachable === false);
    }

    /* ================================================================== */
    section('10. Salg');

    {
      const t = await createTestPlayer({ cash: 200000 });
      const bought = await buyVehicle(t.player.id, 'sedan', 'Selges aktiv');
      await activateVehicle(t.player.id, bought.vehicle.id);
      const cashBefore = (await reload(t.player.id)).cash;

      const res = await post(server.base, '/kjoretoy/selg', {
        cookie: t.cookie,
        body: { vehicleId: bought.vehicle.id },
      });
      check('salg av aktivt kjøretøy svarer 200', res.status === 200, String(res.status));
      check('salgsverdien er eiendelens', res.body?.saleValue === calculateSaleValue(75000, 100),
        `${res.body?.saleValue}`);
      check('spilleren fikk pengene',
        (await reload(t.player.id)).cash === cashBefore + res.body.saleValue);
      check('kjøretøyraden er borte', (await vehiclesOf(t.player.id)).length === 0);
      check('eiendelsraden er borte', (await assetsOf(t.player.id)).length === 0);
      check('ingen står igjen som aktiv', res.body?.active === null);
      check(
        'salget ble bokført',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'EIENDEL_SALG' },
        })) === 1,
      );
    }

    {
      const t = await createTestPlayer({ cash: 50000 });
      const bought = await buyVehicle(t.player.id, 'moped', 'Selges parkert');

      const sold = await settle(() => sellVehicle(t.player.id, bought.vehicle.id));
      check('salg av parkert kjøretøy fungerer', sold.ok, sold.code);
      check('raden er borte', (await vehiclesOf(t.player.id)).length === 0);

      const again = await settle(() => sellVehicle(t.player.id, bought.vehicle.id));
      check('å selge det igjen avvises', !again.ok, 'lyktes uventet');
      check('svaret er nøytralt', again.code === 'IKKE_FUNNET', again.code);
    }

    {
      // Selling through the existing asset endpoint removes the vehicle too.
      const t = await createTestPlayer({ cash: 50000 });
      const bought = await buyVehicle(t.player.id, 'moped', 'Solgt som eiendel');
      await activateVehicle(t.player.id, bought.vehicle.id);

      const result = await settle(() => sellAsset(t.player.id, bought.vehicle.assetId));
      check('eiendelssalget fungerer fortsatt', result.ok, result.code);
      check('kjøretøyet forsvinner med eiendelen', (await vehiclesOf(t.player.id)).length === 0);
      check('ingen foreldreløs rad blir liggende',
        (await prisma.vehicle.count({ where: { assetId: bought.vehicle.assetId } })) === 0);
    }

    /* ================================================================== */
    section('11. Eierskap og sikkerhet');

    {
      const owner = await createTestPlayer({ cash: 200000, currentDistrictId: 'sentrum' });
      const stranger = await createTestPlayer({ cash: 200000, currentDistrictId: 'sentrum' });
      const bought = await buyVehicle(owner.player.id, 'sedan', 'Ikke ditt');

      const attempts: Array<[string, Promise<{ status: number; body: any }>]> = [
        ['detaljen', get(server.base, `/kjoretoy/${bought.vehicle.id}`, { cookie: stranger.cookie })],
        [
          'aktivering',
          post(server.base, '/kjoretoy/aktiver', {
            cookie: stranger.cookie,
            body: { vehicleId: bought.vehicle.id },
          }),
        ],
        [
          'parkering',
          post(server.base, '/kjoretoy/park', {
            cookie: stranger.cookie,
            body: { vehicleId: bought.vehicle.id },
          }),
        ],
        [
          'flytting',
          post(server.base, '/kjoretoy/flytt', {
            cookie: stranger.cookie,
            body: { vehicleId: bought.vehicle.id, destinationDistrictId: 'neon' },
          }),
        ],
        [
          'salg',
          post(server.base, '/kjoretoy/selg', {
            cookie: stranger.cookie,
            body: { vehicleId: bought.vehicle.id },
          }),
        ],
      ];

      for (const [name, promise] of attempts) {
        const res = await promise;
        check(`${name} mot andres kjøretøy gir 404`, res.status === 404, String(res.status));
        check(`${name} lekker ingenting`, !JSON.stringify(res.body ?? {}).includes('Ikke ditt'));
      }

      const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: bought.vehicle.id } });
      check('kjøretøyet er uendret', row.isActive === false &&
        row.locationDistrictId === 'sentrum' && row.playerId === owner.player.id);
      check('den fremmede eier ingenting', (await vehiclesOf(stranger.player.id)).length === 0);
      check(
        'og fikk ingen penger',
        (await reload(stranger.player.id)).cash === 200000,
      );

      // Selling somebody else's asset through the asset endpoint fails too.
      const asAsset = await post(server.base, '/eiendeler/selg', {
        cookie: stranger.cookie,
        body: { assetId: bought.vehicle.assetId },
      });
      check('andres eiendel kan ikke selges', asAsset.status === 404, String(asAsset.status));
      check('kjøretøyet lever fortsatt',
        (await prisma.vehicle.count({ where: { id: bought.vehicle.id } })) === 1);
    }

    {
      const t = await createTestPlayer({ cash: 300000, currentDistrictId: 'blokkene' });
      const other = await createTestPlayer({ cash: 0 });

      const res = await post(server.base, '/kjoretoy/kjop', {
        cookie: t.cookie,
        body: {
          vehicleTypeId: 'sportsbil',
          name: 'Manipulert',
          price: 1,
          purchasePrice: 1,
          currentValue: 999999999,
          condition: 3,
          isActive: true,
          locationDistrictId: 'regjeringskvartalet',
          districtId: 'regjeringskvartalet',
          playerId: other.player.id,
          cash: 999999999,
          saleValue: 999999,
          risk: 0,
          visibility: 0,
        },
      });

      check('kjøpet går gjennom', res.status === 201, String(res.status));

      const rows = await vehiclesOf(t.player.id);
      const assets = await assetsOf(t.player.id);
      check('klientens pris ble ignorert',
        (await reload(t.player.id)).cash === 300000 - 250000);
      check('klientens tilstand ble ignorert', assets[0]!.condition === 100);
      check('klientens verdi ble ignorert', assets[0]!.currentValue === 250000);
      check('klientens distrikt ble ignorert', rows[0]!.locationDistrictId === 'blokkene',
        rows[0]!.locationDistrictId);
      check('klientens isActive ble ignorert', rows[0]!.isActive === false);
      check('klientens playerId ble ignorert', rows[0]!.playerId === t.player.id);
      check('klientens risiko ble ignorert', assets[0]!.risk === 5, `${assets[0]!.risk}`);
      check('den andre spilleren eier ingenting', (await vehiclesOf(other.player.id)).length === 0);
      check('og fikk ingen penger', (await reload(other.player.id)).cash === 0);

      // The buyer's own private view is part of a purchase response, the same
      // way it is for every other purchase - but secrets never are, and neither
      // is anything belonging to the other player.
      const blob = JSON.stringify(res.body);
      for (const field of ['passwordHash', 'usernameLower', 'token', 'expiresAt']) {
        check(`${field} lekker ikke`, !blob.includes(field));
      }
      check('den andre spillerens id er ikke i svaret', !blob.includes(other.player.id));
      check('den andre spillerens navn er ikke i svaret', !blob.includes(other.player.username));
    }

    {
      const t = await createTestPlayer({ cash: 50000 });

      const unknown = await get(server.base, '/kjoretoy/finnes-ikke', { cookie: t.cookie });
      check('ukjent kjøretøy gir 404', unknown.status === 404, String(unknown.status));
      check(
        'meldingen er norsk',
        /Fant ikke dette kjøretøyet/.test(unknown.body?.error?.message ?? ''),
        unknown.body?.error?.message,
      );

      const paths: Array<[string, () => Promise<{ status: number }>]> = [
        ['lista', () => get(server.base, '/kjoretoy')],
        ['katalogen', () => get(server.base, '/kjoretoy/katalog')],
        [
          'kjøp',
          () =>
            post(server.base, '/kjoretoy/kjop', {
              body: { vehicleTypeId: 'moped', name: 'Uten konto' },
            }),
        ],
        [
          'aktivering',
          () => post(server.base, '/kjoretoy/aktiver', { body: { vehicleId: 'noe' } }),
        ],
        ['parkering', () => post(server.base, '/kjoretoy/park', { body: { vehicleId: 'noe' } })],
        [
          'flytting',
          () =>
            post(server.base, '/kjoretoy/flytt', {
              body: { vehicleId: 'noe', destinationDistrictId: 'neon' },
            }),
        ],
        ['salg', () => post(server.base, '/kjoretoy/selg', { body: { vehicleId: 'noe' } })],
      ];

      for (const [name, call] of paths) {
        const res = await call();
        check(`${name} krever innlogging`, res.status === 401, String(res.status));
      }
    }

    /* ================================================================== */
    section('12. Tjue samtidige kjøp med råd til ett');

    {
      const t = await createTestPlayer({ cash: 80000 });

      const results = await burst(20, (i) =>
        settle(() => buyVehicle(t.player.id, 'sedan', `Sedan ${i}`)),
      );
      const ok = results.filter((r) => r.ok);
      const denied = results.filter((r) => r.code === 'IKKE_NOK_MIDLER');

      note(`ok=${ok.length} avvist=${denied.length}`);
      check('nøyaktig ett kjøp lykkes', ok.length === 1, `${ok.length}`);
      check('resten avvises for lite penger', denied.length === 19, `${denied.length}`);

      const after = await reload(t.player.id);
      check('kontanter blir aldri negative', after.cash >= 0, `${after.cash}`);
      check('nøyaktig én betaling', after.cash === 5000, `${after.cash}`);
      check('nøyaktig ett kjøretøy', (await vehiclesOf(t.player.id)).length === 1);
      check('nøyaktig én eiendel', (await assetsOf(t.player.id)).length === 1);
      check(
        'nøyaktig én kjøpstransaksjon',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'EIENDEL_KJOP' },
        })) === 1,
      );
    }

    /* ================================================================== */
    section('13. Tjue samtidige kjøp ved fire fra før');

    {
      const t = await createTestPlayer({ cash: 500000 });
      for (let i = 1; i <= 4; i += 1) {
        await buyVehicle(t.player.id, 'gammel-sykkel', `Sykkel ${i}`);
      }

      const results = await burst(20, (i) =>
        settle(() => buyVehicle(t.player.id, 'moped', `Moped ${i}`)),
      );
      const ok = results.filter((r) => r.ok);
      const denied = results.filter((r) => r.code === 'MAKS_KJORETOY');

      note(`ok=${ok.length} avvist=${denied.length}`);
      check('nøyaktig ett kjøp lykkes', ok.length === 1, `${ok.length}`);
      check('resten avvises av maksgrensen', denied.length === 19, `${denied.length}`);
      check('spilleren har nøyaktig fem', (await vehiclesOf(t.player.id)).length === 5);
      check('aldri seks', (await vehiclesOf(t.player.id)).length <= 5);
      check(
        'og like mange eiendeler',
        (await assetsOf(t.player.id)).length === 5,
      );
    }

    /* ================================================================== */
    section('14. Tjue samtidige aktiveringer');

    {
      const t = await createTestPlayer({ cash: 200000 });
      const vehicles: Array<{ id: string }> = [];
      for (let i = 1; i <= 4; i += 1) {
        vehicles.push((await buyVehicle(t.player.id, 'moped', `Kandidat ${i}`)).vehicle);
      }

      const results = await burst(20, (i) =>
        settle(() => activateVehicle(t.player.id, vehicles[i % vehicles.length]!.id)),
      );
      const ok = results.filter((r) => r.ok);
      note(`ok=${ok.length} avvist=${results.length - ok.length}`);

      const rows = await vehiclesOf(t.player.id);
      const active = rows.filter((v) => v.isActive);
      check('nøyaktig ett kjøretøy er aktivt', active.length === 1, `${active.length}`);
      check('alle fire finnes fortsatt', rows.length === 4);
      check('ingen operasjon feilet uventet',
        results.every((r) => r.ok || r.code === 'KUNNE_IKKE_AKTIVERE'),
        results.map((r) => r.code).filter(Boolean).join(','));
    }

    /* ================================================================== */
    section('15. Samtidig parkering og aktivering');

    {
      const t = await createTestPlayer({ cash: 200000 });
      const a = (await buyVehicle(t.player.id, 'moped', 'Alfa')).vehicle;
      const b = (await buyVehicle(t.player.id, 'bruktbil', 'Beta')).vehicle;
      await activateVehicle(t.player.id, a.id);

      const results = await Promise.all([
        ...Array.from({ length: 10 }, () => settle(() => parkVehicle(t.player.id, a.id))),
        ...Array.from({ length: 10 }, () => settle(() => activateVehicle(t.player.id, b.id))),
      ]);

      const rows = await vehiclesOf(t.player.id);
      const active = rows.filter((v) => v.isActive);
      note(`${results.filter((r) => r.ok).length} operasjoner lyktes`);
      check('høyst ett kjøretøy er aktivt', active.length <= 1, `${active.length}`);
      check('ingen umulig sluttstatus', rows.every((v) => typeof v.isActive === 'boolean'));
      check('begge kjøretøyene finnes fortsatt', rows.length === 2);
      check(
        'ingen uventede feil',
        results.every((r) => r.ok || r.code === 'KUNNE_IKKE_AKTIVERE'),
        results.map((r) => r.code).filter(Boolean).join(','),
      );
    }

    /* ================================================================== */
    section('16. Samtidig flytting');

    {
      const t = await createTestPlayer({ cash: 200000, currentDistrictId: 'sentrum' });
      const bought = await buyVehicle(t.player.id, 'sedan', 'Kappløpet');
      await activateVehicle(t.player.id, bought.vehicle.id);

      const destinations = ['neon', 'havna', 'industrien', 'blokkene'];
      const results = await burst(20, (i) =>
        settle(() =>
          moveVehicle(t.player.id, bought.vehicle.id, destinations[i % destinations.length]!),
        ),
      );

      const ok = results.filter((r) => r.ok);
      note(`ok=${ok.length} avvist=${results.length - ok.length}`);
      check('nøyaktig én flytting lykkes', ok.length === 1, `${ok.length}`);
      check(
        'resten avvises fordi bilen ikke lenger står her',
        results.filter((r) => r.code === 'ANNET_DISTRIKT').length === 19,
        `${results.filter((r) => r.code === 'ANNET_DISTRIKT').length}`,
      );

      const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: bought.vehicle.id } });
      check('kjøretøyet står i nøyaktig ett gyldig distrikt',
        destinations.includes(row.locationDistrictId), row.locationDistrictId);
      check('spilleren står fortsatt i Sentrum',
        (await reload(t.player.id)).currentDistrictId === 'sentrum');
    }

    /* ================================================================== */
    section('17. Samtidig flytting og aktivering');

    {
      const t = await createTestPlayer({ cash: 200000, currentDistrictId: 'sentrum' });
      const a = (await buyVehicle(t.player.id, 'moped', 'Flytter')).vehicle;
      const b = (await buyVehicle(t.player.id, 'bruktbil', 'Aktiverer')).vehicle;
      await activateVehicle(t.player.id, a.id);

      const results = await Promise.all([
        ...Array.from({ length: 8 }, () => settle(() => moveVehicle(t.player.id, a.id, 'neon'))),
        ...Array.from({ length: 8 }, () => settle(() => activateVehicle(t.player.id, b.id))),
      ]);

      const rows = await vehiclesOf(t.player.id);
      const active = rows.filter((v) => v.isActive);
      note(`${results.filter((r) => r.ok).length} operasjoner lyktes`);
      check('høyst ett aktivt kjøretøy', active.length <= 1, `${active.length}`);
      check(
        'kjøretøyet står enten i Sentrum eller Neon, aldri noe annet',
        ['sentrum', 'neon'].includes(rows.find((v) => v.id === a.id)!.locationDistrictId),
        rows.find((v) => v.id === a.id)!.locationDistrictId,
      );
      check(
        'det andre kjøretøyet har ikke flyttet seg',
        rows.find((v) => v.id === b.id)!.locationDistrictId === 'sentrum',
      );
      check(
        'ingen uventede feil',
        results.every(
          (r) => r.ok || ['KUNNE_IKKE_AKTIVERE', 'ANNET_DISTRIKT', 'IKKE_AKTIVT'].includes(r.code!),
        ),
        results.map((r) => r.code).filter(Boolean).join(','),
      );
    }

    /* ================================================================== */
    section('18. Samtidig salg og aktivering');

    {
      const t = await createTestPlayer({ cash: 200000 });
      const a = (await buyVehicle(t.player.id, 'moped', 'Selges')).vehicle;
      const b = (await buyVehicle(t.player.id, 'bruktbil', 'Beholdes')).vehicle;

      const results = await Promise.all([
        ...Array.from({ length: 6 }, () => settle(() => sellVehicle(t.player.id, a.id))),
        ...Array.from({ length: 6 }, () => settle(() => activateVehicle(t.player.id, a.id))),
        ...Array.from({ length: 4 }, () => settle(() => activateVehicle(t.player.id, b.id))),
      ]);

      const sales = results.filter((r) => r.ok && r.value && 'saleValue' in (r.value as object));
      note(`${sales.length} salg lyktes`);
      check('kjøretøyet selges nøyaktig én gang', sales.length === 1, `${sales.length}`);

      const rows = await vehiclesOf(t.player.id);
      check('det solgte kjøretøyet er borte', rows.every((v) => v.id !== a.id));
      check('et solgt kjøretøy kan ikke ende aktivt',
        (await prisma.vehicle.count({ where: { id: a.id } })) === 0);
      check('høyst ett aktivt igjen', rows.filter((v) => v.isActive).length <= 1);
      check(
        'nøyaktig én salgstransaksjon',
        (await prisma.transaction.count({
          where: { playerId: t.player.id, type: 'EIENDEL_SALG' },
        })) === 1,
      );
    }

    /* ================================================================== */
    section('19. Samtidig kjøp og bankoperasjon');

    {
      const seedCash = 100000;
      const t = await createTestPlayer({ cash: seedCash, bankBalance: 0 });

      const results = await Promise.all([
        settle(() => buyVehicle(t.player.id, 'sedan', 'Samtidig')),
        settle(() => buyVehicle(t.player.id, 'bruktbil', 'Samtidig 2')),
        post(server.base, '/spiller/bank/innskudd', { cookie: t.cookie, body: { amount: 20000 } }),
        settle(() => buyVehicle(t.player.id, 'moped', 'Samtidig 3')),
      ]);

      const after = await reload(t.player.id);
      const ledger = await prisma.transaction.findMany({ where: { playerId: t.player.id } });
      const cashDelta = ledger
        .filter((row) => row.ledger === 'CASH')
        .reduce((sum, row) => sum + row.amount, 0);

      note(`cash ${seedCash} -> ${after.cash}, bank ${after.bankBalance}`);
      check('kontanter er aldri negative', after.cash >= 0, `${after.cash}`);
      check('banksaldoen er aldri negativ', after.bankBalance >= 0);
      check(
        'regnskapet forklarer hele endringen i kontanter',
        cashDelta === after.cash - seedCash,
        `${cashDelta} vs ${after.cash - seedCash}`,
      );
      check(
        'like mange kjøretøy som eiendeler',
        (await vehiclesOf(t.player.id)).length === (await assetsOf(t.player.id)).length,
      );
      // Every vehicle points at an asset the player still owns.
      const ownedAssetIds = new Set((await assetsOf(t.player.id)).map((a) => a.id));
      check(
        'ingen kjøretøy uten eiendel',
        (await vehiclesOf(t.player.id)).every((v) => ownedAssetIds.has(v.assetId)),
      );
      check(`${results.filter((r) => 'ok' in r && r.ok).length} tjenestekall lyktes`, true);
    }

    /* ================================================================== */
    section('20. Rollback');

    {
      // A real PostgreSQL constraint failure, after the money has moved and
      // the asset row has been written.
      const t = await createTestPlayer({ cash: 100000 });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_rollback_probe" CHECK ("name" <> 'Rullbakk')`,
      );

      try {
        const result = await settle(() => buyVehicle(t.player.id, 'sedan', 'Rullbakk'));
        check('kjøpet feiler på databasefeilen', !result.ok, 'lyktes uventet');

        check('kontantene er rullet tilbake', (await reload(t.player.id)).cash === 100000);
        check('ingen kjøretøyrad ble liggende igjen', (await vehiclesOf(t.player.id)).length === 0);
        check('ingen eiendelsrad ble liggende igjen', (await assetsOf(t.player.id)).length === 0);
        check(
          'ingen transaksjon ble liggende igjen',
          (await prisma.transaction.count({ where: { playerId: t.player.id } })) === 0,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_rollback_probe"`,
        );
      }
    }

    {
      // Selling at the wealth ceiling: the ledger refuses after the asset and
      // its vehicle have already been deleted.
      const t = await createTestPlayer({ cash: 2_000_000_000 });
      const asset = await prisma.asset.create({
        data: {
          playerId: t.player.id,
          assetTypeId: 'sportsbil',
          name: 'Sportsbil',
          category: 'VEHICLE',
          purchasePrice: 250000,
          currentValue: 250000,
          condition: 100,
          maintenanceCostPerDay: 900,
          visibility: 75,
          risk: 5,
          location: 'sentrum',
          status: 'ACTIVE',
        },
      });
      const vehicle = await prisma.vehicle.create({
        data: {
          playerId: t.player.id,
          assetId: asset.id,
          vehicleTypeId: 'sportsbil',
          name: 'Taket',
          locationDistrictId: 'sentrum',
          isActive: true,
        },
      });

      const result = await settle(() => sellVehicle(t.player.id, vehicle.id));
      check('salget avvises', !result.ok, 'lyktes uventet');
      check('feilkoden er taket', result.code === 'TAK_NADD', result.code);

      check('kjøretøyet er rullet tilbake',
        (await prisma.vehicle.count({ where: { id: vehicle.id } })) === 1);
      check('eiendelen er rullet tilbake',
        (await prisma.asset.count({ where: { id: asset.id } })) === 1);
      check('det er fortsatt aktivt',
        (await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).isActive === true);
      check('kontantene er uendret', (await reload(t.player.id)).cash === 2_000_000_000);
      check(
        'ingen transaksjon ble liggende igjen',
        (await prisma.transaction.count({ where: { playerId: t.player.id } })) === 0,
      );
    }

    /* ================================================================== */
    section('21. Databasens egne skranker');

    {
      const t = await createTestPlayer({ cash: 200000 });
      const a = (await buyVehicle(t.player.id, 'moped', 'Skranke A')).vehicle;
      const b = (await buyVehicle(t.player.id, 'bruktbil', 'Skranke B')).vehicle;
      await activateVehicle(t.player.id, a.id);

      const two = await settle(() =>
        prisma.vehicle.update({ where: { id: b.id }, data: { isActive: true } }),
      );
      check('databasen nekter to aktive kjøretøy', !two.ok, 'lyktes uventet');

      const short = await settle(() =>
        prisma.vehicle.update({ where: { id: b.id }, data: { name: 'ab' } }),
      );
      check('databasen nekter for kort navn', !short.ok, 'lyktes uventet');

      const duplicate = await settle(() =>
        prisma.vehicle.create({
          data: {
            playerId: t.player.id,
            assetId: a.assetId,
            vehicleTypeId: 'moped',
            name: 'Dobbel',
            locationDistrictId: 'sentrum',
          },
        }),
      );
      check('én eiendel kan ikke bli to kjøretøy', !duplicate.ok, 'lyktes uventet');

      check('tilstanden er uendret', (await vehiclesOf(t.player.id)).filter((v) => v.isActive)
        .length === 1);
    }

    /* ================================================================== */
    section('22. Rate limiting per spiller');

    {
      const t = await createTestPlayer({ cash: 10_000_000 });

      const results: Array<{ status: number; body: any }> = [];
      for (let i = 0; i < 25; i += 1) {
        results.push(
          await post(server.base, '/kjoretoy/kjop', {
            cookie: t.cookie,
            body: { vehicleTypeId: 'gammel-sykkel', name: `Sykkel ${i}` },
          }),
        );
      }

      const created = results.filter((r) => r.status === 201).length;
      const maxed = results.filter((r) => r.body?.error?.code === 'MAKS_KJORETOY').length;
      const limited = results.filter((r) => r.status === 429);

      note(`opprettet=${created} maksgrense=${maxed} rate-limited=${limited.length}`);
      check('nøyaktig 20 slipper gjennom', created + maxed === 20, `${created + maxed}`);
      check('resten blokkeres', limited.length === 5, `${limited.length}`);
      check(
        'meldingen er på norsk',
        limited[0]?.body?.error?.message === 'Du kjøper for raskt. Vent litt.',
        limited[0]?.body?.error?.message,
      );
      check('spillregelen holder uansett', (await vehiclesOf(t.player.id)).length === 5);

      const other = await createTestPlayer({ cash: 50000 });
      const free = await post(server.base, '/kjoretoy/kjop', {
        cookie: other.cookie,
        body: { vehicleTypeId: 'moped', name: 'Egen kvote' },
      });
      check('en annen spiller har egen kvote', free.status === 201, String(free.status));
    }

    {
      const t = await createTestPlayer({ cash: 50000 });
      const bought = await buyVehicle(t.player.id, 'moped', 'Handlingsgrense');

      const results: Array<{ status: number; body: any }> = [];
      for (let i = 0; i < 35; i += 1) {
        results.push(
          await post(server.base, '/kjoretoy/park', {
            cookie: t.cookie,
            body: { vehicleId: bought.vehicle.id },
          }),
        );
      }

      const ok = results.filter((r) => r.status === 200).length;
      const limited = results.filter((r) => r.status === 429).length;
      note(`handlinger ok=${ok} blokkert=${limited}`);
      check('handlinger slipper gjennom 30', ok === 30, `${ok}`);
      check('resten blokkeres', limited === 5, `${limited}`);
    }

    /* ================================================================== */
    section('23. Ingen andre systemer er rørt');

    {
      const t = await createTestPlayer({
        cash: 200000,
        energy: 100,
        heat: 0,
        currentDistrictId: 'sentrum',
      });
      const before = await reload(t.player.id);

      const bought = await buyVehicle(t.player.id, 'moped', 'Nøytral');
      await activateVehicle(t.player.id, bought.vehicle.id);
      await moveVehicle(t.player.id, bought.vehicle.id, 'neon');
      await parkVehicle(t.player.id, bought.vehicle.id);

      const after = await reload(t.player.id);
      check('energien er urørt', after.energy === before.energy, `${after.energy}`);
      check('heat er urørt', after.heat === before.heat);
      check('helsa er urørt', after.health === before.health);
      check('XP er urørt', after.xp === before.xp);
      check('nivået er urørt', after.level === before.level);
      check('ferdighetspoeng er urørt', after.skillPoints === before.skillPoints);
      check('spillerens distrikt er urørt', after.currentDistrictId === 'sentrum');
      check(
        'flytting koster ingenting',
        after.cash === before.cash - 8000,
        `${after.cash}`,
      );
      check(
        'kun kjøpet ble bokført',
        (await prisma.transaction.count({ where: { playerId: t.player.id } })) === 1,
      );
      check(
        'ingen kriminalitetsforsøk ble skrevet',
        (await prisma.crimeAttempt.count({ where: { playerId: t.player.id } })) === 0,
      );

      // The asset side still behaves like an asset.
      const assets = await assetsOf(t.player.id);
      check('eiendelen er fortsatt lagret utenfor inventaret',
        assets[0]!.storageLocation === 'STORED');
      check('eiendelens sted er der den ble kjøpt', assets[0]!.location === 'sentrum',
        assets[0]!.location);
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
