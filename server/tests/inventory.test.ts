/**
 * Integration tests for the inventory, against the real PostgreSQL database and
 * a real Express server.
 *
 * Run with `npm -w @skyggeby/server run test:inventory`.
 */
import {
  ASSET_TYPES,
  CARRYABLE_CATEGORIES,
  INVENTORY_CAPACITY,
  inventorySlotsFor,
  isInventoryEligible,
} from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/errors';
import { buyAsset } from '../src/modules/assets/asset.service';
import {
  addToInventory,
  calculateInventoryUsage,
  removeFromInventory,
} from '../src/modules/inventory/inventory.service';
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

/** Gives a player one asset of a type without going through the shop. */
async function giveAsset(
  playerId: string,
  assetTypeId: string,
  overrides: Record<string, unknown> = {},
) {
  const definition = ASSET_TYPES.find((a) => a.id === assetTypeId)!;
  return prisma.asset.create({
    data: {
      playerId,
      assetTypeId: definition.id,
      name: definition.name,
      category: definition.category,
      purchasePrice: definition.purchasePrice,
      currentValue: definition.purchasePrice,
      condition: 100,
      maintenanceCostPerDay: definition.maintenanceCostPerDay,
      visibility: definition.visibility,
      risk: definition.risk,
      location: 'sentrum',
      status: 'ACTIVE',
      ...overrides,
    },
  });
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1-4. Tomt inventar, kapasitet og katalogdata');

    {
      const t = await createTestPlayer();
      const res = await get(server.base, '/inventar', { cookie: t.cookie });

      check('svarer 200', res.status === 200, String(res.status));
      check('tomt inventar', res.body?.items?.length === 0);
      check('ingenting lagret heller', res.body?.stored?.length === 0);
      check('kapasitet er 10', res.body?.capacity === 10, String(res.body?.capacity));
      check('brukte plasser er 0', res.body?.usedSlots === 0);
      check('ledige plasser er 10', res.body?.remainingSlots === 10);
      check('konstanten er sentral', INVENTORY_CAPACITY === 10);

      // Slot costs come from the catalogue, not from the row.
      const expected: Record<string, number> = {
        lommelykt: 1,
        laseverktoy: 1,
        verktoykasse: 2,
        forkledning: 1,
        'profesjonelt-verktoy': 3,
        'enkel-telefon': 1,
        smarttelefon: 1,
        'kryptert-telefon': 1,
        laptop: 2,
        overvakningsutstyr: 3,
        solvklokke: 1,
        gullkjede: 1,
        samleobjekt: 2,
        'sjeldent-kunstverk': 3,
        diamant: 2,
      };
      const wrong = Object.entries(expected).filter(
        ([id, slots]) => inventorySlotsFor(id) !== slots,
      );
      check('alle plasskostnader stemmer med spesifikasjonen', wrong.length === 0,
        wrong.map(([id]) => id).join(','));

      const vehicles = ASSET_TYPES.filter((a) => a.category === 'VEHICLE');
      check('fem kjøretøy kan ikke bæres',
        vehicles.length === 5 && vehicles.every((v) => !v.inventoryEligible));
      check('alle andre kan bæres',
        ASSET_TYPES.filter((a) => a.category !== 'VEHICLE').every((a) => a.inventoryEligible));
      check('kjøretøyfilteret vises ikke',
        !CARRYABLE_CATEGORIES.includes('VEHICLE'),
        CARRYABLE_CATEGORIES.join(','));
    }

    /* ================================================================== */
    section('5-9. Legg inn per kategori');

    {
      const t = await createTestPlayer();
      const equipment = await giveAsset(t.player.id, 'laseverktoy');
      const technology = await giveAsset(t.player.id, 'laptop');
      const valuable = await giveAsset(t.player.id, 'diamant');
      const vehicle = await giveAsset(t.player.id, 'sportsbil');

      const eq = await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: equipment.id },
      });
      check('utstyr kan legges inn', eq.status === 200, String(eq.status));
      check('meldingen er norsk', eq.body?.message === 'Låseverktøy ble lagt i inventaret.',
        eq.body?.message);
      check('brukte plasser oppdateres', eq.body?.usedSlots === 1, String(eq.body?.usedSlots));

      const tech = await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: technology.id },
      });
      check('teknologi kan legges inn', tech.status === 200, String(tech.status));
      check('laptop tar to plasser', tech.body?.usedSlots === 3, String(tech.body?.usedSlots));

      const val = await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: valuable.id },
      });
      check('verdier kan legges inn', val.status === 200, String(val.status));
      check('diamant tar to plasser', val.body?.usedSlots === 5, String(val.body?.usedSlots));

      const veh = await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: vehicle.id },
      });
      check('kjøretøy avvises', veh.status === 400, String(veh.status));
      check('feilkoden er riktig', veh.body?.error?.code === 'KAN_IKKE_BAERES',
        veh.body?.error?.code);
      check('meldingen er norsk',
        veh.body?.error?.message === 'Denne eiendelen kan ikke bæres.',
        veh.body?.error?.message);

      const listed = await get(server.base, '/inventar', { cookie: t.cookie });
      check('tre bæres', listed.body.items.length === 3, String(listed.body.items.length));
      check('kjøretøyet ligger lagret', listed.body.stored.length === 1);
      check('ledige plasser er 5', listed.body.remainingSlots === 5);
      check('kjøretøyet er merket som ikke bærbart',
        listed.body.stored[0].blockedText === 'Denne eiendelen kan ikke bæres.' &&
          listed.body.stored[0].canAdd === false);
    }

    /* ================================================================== */
    section('10-12. Ta ut, eierskap og dobbel innlegging');

    {
      const t = await createTestPlayer();
      const asset = await giveAsset(t.player.id, 'verktoykasse');

      await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: asset.id },
      });

      const again = await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: asset.id },
      });
      check('kan ikke legges inn to ganger', again.status === 400, String(again.status));
      check('meldingen er norsk',
        again.body?.error?.message === 'Eiendelen ligger allerede i inventaret.',
        again.body?.error?.message);
      check('fortsatt bare to plasser brukt',
        (await get(server.base, '/inventar', { cookie: t.cookie })).body.usedSlots === 2);

      const out = await post(server.base, '/inventar/ta-ut', {
        cookie: t.cookie,
        body: { assetId: asset.id },
      });
      check('ta ut fungerer', out.status === 200, String(out.status));
      check('meldingen er norsk',
        out.body?.message === 'Verktøykasse ble tatt ut av inventaret.', out.body?.message);
      check('plassene frigjøres', out.body?.usedSlots === 0, String(out.body?.usedSlots));
      check('den ligger lagret igjen',
        (await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).storageLocation ===
          'STORED');

      const outAgain = await post(server.base, '/inventar/ta-ut', {
        cookie: t.cookie,
        body: { assetId: asset.id },
      });
      check('kan ikke tas ut to ganger', outAgain.status === 400, String(outAgain.status));
      check('meldingen er norsk',
        outAgain.body?.error?.message === 'Eiendelen ligger ikke i inventaret.',
        outAgain.body?.error?.message);

      // Ownership.
      const victim = await createTestPlayer();
      const victimAsset = await giveAsset(victim.player.id, 'smarttelefon');
      const thief = await createTestPlayer();

      const stolen = await post(server.base, '/inventar/legg-inn', {
        cookie: thief.cookie,
        body: { assetId: victimAsset.id },
      });
      check('andres eiendel gir 404', stolen.status === 404, String(stolen.status));
      check('meldingen røper ingenting',
        stolen.body?.error?.message === 'Eiendelen finnes ikke.',
        stolen.body?.error?.message);
      check('offerets eiendel er uendret',
        (await prisma.asset.findUniqueOrThrow({ where: { id: victimAsset.id } }))
          .storageLocation === 'STORED');
      check('tyven har fortsatt tomt inventar',
        (await get(server.base, '/inventar', { cookie: thief.cookie })).body.items.length === 0);

      const listed = await get(server.base, '/inventar', { cookie: victim.cookie });
      check('GET returnerer kun egne eiendeler',
        listed.body.stored.every((i: any) => i.name === 'Smarttelefon') &&
          listed.body.stored.length === 1);
    }

    /* ================================================================== */
    section('13-16. Kapasitet');

    {
      const t = await createTestPlayer();
      // 3 + 3 + 2 + 1 = 9 slots.
      const a = await giveAsset(t.player.id, 'profesjonelt-verktoy');
      const b = await giveAsset(t.player.id, 'overvakningsutstyr');
      const c = await giveAsset(t.player.id, 'laptop');
      const d = await giveAsset(t.player.id, 'lommelykt');
      const big = await giveAsset(t.player.id, 'sjeldent-kunstverk');

      for (const asset of [a, b, c, d]) {
        await post(server.base, '/inventar/legg-inn', {
          cookie: t.cookie,
          body: { assetId: asset.id },
        });
      }

      const state = await get(server.base, '/inventar', { cookie: t.cookie });
      check('brukte plasser er 9', state.body.usedSlots === 9, String(state.body.usedSlots));
      check('ledige plasser er 1', state.body.remainingSlots === 1);

      // Needs 3, only 1 free.
      const tooBig = await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: big.id },
      });
      check('for stor gjenstand avvises', tooBig.status === 400, String(tooBig.status));
      check('feilkoden er riktig', tooBig.body?.error?.code === 'INGEN_PLASS',
        tooBig.body?.error?.code);
      check('meldingen forklarer plassen',
        /krever 3 plasser, du har 1 ledig/.test(tooBig.body?.error?.message ?? ''),
        tooBig.body?.error?.message);
      check('den er merket i lista',
        state.body.stored.find((i: any) => i.id === big.id)?.blockedText === 'Ikke nok plass');

      // Fill the last slot, then everything is refused.
      const last = await giveAsset(t.player.id, 'gullkjede');
      await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: last.id },
      });

      const full = await get(server.base, '/inventar', { cookie: t.cookie });
      check('inventaret er fullt', full.body.usedSlots === 10 && full.body.remainingSlots === 0);

      const extra = await giveAsset(t.player.id, 'lommelykt');
      const refused = await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: extra.id },
      });
      check('fullt inventar avviser', refused.status === 400, String(refused.status));
      check('meldingen er "Inventaret er fullt."',
        refused.body?.error?.message === 'Inventaret er fullt.',
        refused.body?.error?.message);
      check('aldri over kapasitet',
        (await get(server.base, '/inventar', { cookie: t.cookie })).body.usedSlots <= 10);

      // The central function agrees with the API.
      const usage = calculateInventoryUsage(await assetsOf(t.player.id));
      check('den sentrale funksjonen gir samme svar',
        usage.usedSlots === 10 && usage.remainingSlots === 0 && usage.capacity === 10,
        `${usage.usedSlots}/${usage.capacity}`);
    }

    /* ================================================================== */
    section('17-19. Kjøp, migrering og distrikt');

    {
      const t = await createTestPlayer({ cash: 50000 });
      await prisma.player.update({
        where: { id: t.player.id },
        data: { currentDistrictId: 'havna' },
      });

      await buyAsset(t.player.id, 'laseverktoy');
      const [bought] = await assetsOf(t.player.id);
      check('kjøpte eiendeler starter utenfor inventaret',
        bought!.storageLocation === 'STORED', bought!.storageLocation);
      check('inventaret er fortsatt tomt',
        (await get(server.base, '/inventar', { cookie: t.cookie })).body.items.length === 0);

      // A row written without the column takes the migration default.
      await prisma.$executeRawUnsafe(
        `INSERT INTO assets (id, "playerId", "assetTypeId", name, category,
           "purchasePrice", "currentValue", condition, "maintenanceCostPerDay",
           visibility, risk, location, status, "purchasedAt", "updatedAt")
         VALUES ($1, $2, 'lommelykt', 'Lommelykt', 'EQUIPMENT',
           500, 500, 100, 0, 0, 0, 'sentrum', 'ACTIVE', now(), now())`,
        'qa_legacy_asset',
        t.player.id,
      );
      const legacy = await prisma.asset.findUniqueOrThrow({ where: { id: 'qa_legacy_asset' } });
      check('eksisterende rader migreres til STORED',
        legacy.storageLocation === 'STORED', legacy.storageLocation);

      // Carrying does not move the asset between districts.
      await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: bought!.id },
      });
      check('distriktet er uendret etter innlegging',
        (await prisma.asset.findUniqueOrThrow({ where: { id: bought!.id } })).location ===
          'havna');

      await post(server.base, '/by/flytt', {
        cookie: t.cookie,
        body: { districtId: 'neon' },
      });
      const afterMove = await prisma.asset.findUniqueOrThrow({ where: { id: bought!.id } });
      check('eiendelen blir igjen når spilleren flytter',
        afterMove.location === 'havna', afterMove.location);
      check('den bæres fortsatt', afterMove.storageLocation === 'INVENTORY');
      check('spilleren står i Neon',
        (await reload(t.player.id)).currentDistrictId === 'neon');
    }

    /* ================================================================== */
    section('20-22. Manipulasjon og statusregler');

    {
      const t = await createTestPlayer();
      const victim = await createTestPlayer();
      const asset = await giveAsset(t.player.id, 'verktoykasse');

      const res = await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: {
          assetId: asset.id,
          inventorySlots: 999,
          capacity: 9999,
          usedSlots: 0,
          playerId: victim.player.id,
          ownerId: victim.player.id,
          location: 'regjeringskvartalet',
          status: 'ACTIVE',
          category: 'EQUIPMENT',
          condition: 100,
          price: 1,
        },
      });

      check('forespørselen behandles normalt', res.status === 200, String(res.status));
      check('serverens plasskostnad brukes', res.body?.usedSlots === 2,
        String(res.body?.usedSlots));
      check('kapasiteten er fortsatt 10', res.body?.capacity === 10);
      check('eiendelen havnet ikke hos den andre',
        (await assetsOf(victim.player.id)).length === 0);

      const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
      check('distriktet ble ikke endret', row.location === 'sentrum', row.location);
      check('eieren ble ikke endret', row.playerId === t.player.id);

      // Status rules.
      const seizedOwner = await createTestPlayer();
      const seized = await giveAsset(seizedOwner.player.id, 'laptop', { status: 'SEIZED' });
      const damaged = await giveAsset(seizedOwner.player.id, 'gullkjede', {
        status: 'DAMAGED',
      });

      const seizedRes = await post(server.base, '/inventar/legg-inn', {
        cookie: seizedOwner.cookie,
        body: { assetId: seized.id },
      });
      const damagedRes = await post(server.base, '/inventar/legg-inn', {
        cookie: seizedOwner.cookie,
        body: { assetId: damaged.id },
      });

      check('beslaglagt kan ikke bæres', seizedRes.status === 400, String(seizedRes.status));
      check('beslagsmeldingen er norsk',
        seizedRes.body?.error?.message === 'Beslaglagte eiendeler kan ikke bæres.',
        seizedRes.body?.error?.message);
      check('skadet kan ikke bæres', damagedRes.status === 400, String(damagedRes.status));
      check('skademeldingen er norsk',
        damagedRes.body?.error?.message === 'Skadde eiendeler kan ikke bæres.',
        damagedRes.body?.error?.message);
      check('ingen av dem havnet i inventaret',
        (await get(server.base, '/inventar', { cookie: seizedOwner.cookie })).body.items
          .length === 0);

      // Invalid input.
      const bad = await Promise.all([
        post(server.base, '/inventar/legg-inn', { cookie: t.cookie, body: {} }),
        post(server.base, '/inventar/legg-inn', { cookie: t.cookie, body: { assetId: '' } }),
        post(server.base, '/inventar/legg-inn', { cookie: t.cookie, body: { assetId: 42 } }),
        post(server.base, '/inventar/ta-ut', { cookie: t.cookie, body: { assetId: null } }),
      ]);
      check('ugyldig input avvises', bad.every((r) => r.status === 400),
        bad.map((r) => r.status).join(','));
    }

    /* ================================================================== */
    section('24. Samtidighet: kapasitet');

    {
      // Scenario A: 9/10 used, two one-slot assets, both sent at once.
      const t = await createTestPlayer();
      const filler = await giveAsset(t.player.id, 'profesjonelt-verktoy');
      const filler2 = await giveAsset(t.player.id, 'overvakningsutstyr');
      const filler3 = await giveAsset(t.player.id, 'laptop');
      const filler4 = await giveAsset(t.player.id, 'lommelykt');
      for (const f of [filler, filler2, filler3, filler4]) {
        await addToInventory(t.player.id, f.id);
      }

      const a = await giveAsset(t.player.id, 'laseverktoy');
      const b = await giveAsset(t.player.id, 'gullkjede');

      const results = await Promise.all([
        settle(() => addToInventory(t.player.id, a.id)),
        settle(() => addToInventory(t.player.id, b.id)),
      ]);

      const usage = calculateInventoryUsage(await assetsOf(t.player.id));
      note(`A: ok=${results.filter((r) => r.ok).length} sluttresultat ${usage.usedSlots}/10`);

      check('A: nøyaktig én lykkes', results.filter((r) => r.ok).length === 1);
      check('A: den andre avvises for plass',
        results.some((r) => r.code === 'INGEN_PLASS'));
      check('A: sluttresultat er 10/10', usage.usedSlots === 10, `${usage.usedSlots}`);
      check('A: aldri over kapasitet', usage.usedSlots <= INVENTORY_CAPACITY);
    }

    {
      // Scenario B: 8/10 used, two two-slot assets at once.
      const t = await createTestPlayer();
      const f1 = await giveAsset(t.player.id, 'profesjonelt-verktoy');
      const f2 = await giveAsset(t.player.id, 'overvakningsutstyr');
      const f3 = await giveAsset(t.player.id, 'verktoykasse');
      for (const f of [f1, f2, f3]) await addToInventory(t.player.id, f.id);

      const a = await giveAsset(t.player.id, 'laptop');
      const b = await giveAsset(t.player.id, 'samleobjekt');

      const results = await Promise.all([
        settle(() => addToInventory(t.player.id, a.id)),
        settle(() => addToInventory(t.player.id, b.id)),
      ]);

      const usage = calculateInventoryUsage(await assetsOf(t.player.id));
      note(`B: ok=${results.filter((r) => r.ok).length} sluttresultat ${usage.usedSlots}/10`);

      check('B: nøyaktig én lykkes', results.filter((r) => r.ok).length === 1,
        `${results.filter((r) => r.ok).length}`);
      check('B: sluttresultat er 10/10', usage.usedSlots === 10, `${usage.usedSlots}`);
      check('B: aldri 12/10', usage.usedSlots <= INVENTORY_CAPACITY);
    }

    /* ================================================================== */
    section('25-26. Samtidighet: samme eiendel og eierskap');

    {
      // Scenario C: 20 requests for the same asset.
      const t = await createTestPlayer();
      const asset = await giveAsset(t.player.id, 'laptop');

      const results = await burst(20, () => settle(() => addToInventory(t.player.id, asset.id)));
      const ok = results.filter((r) => r.ok).length;
      const rejected = results.filter((r) => r.code === 'ALLEREDE_I_INVENTAR').length;

      note(`C: ok=${ok} avvist=${rejected}`);
      check('C: nøyaktig én lykkes', ok === 1, `${ok}`);
      check('C: resten avvises rent', rejected === 19, `${rejected}`);

      const usage = calculateInventoryUsage(await assetsOf(t.player.id));
      check('C: kun to plasser brukt', usage.usedSlots === 2, `${usage.usedSlots}`);
      check('C: eiendelen finnes fortsatt én gang',
        (await assetsOf(t.player.id)).length === 1);

      // Concurrent add and remove of the same asset stays consistent.
      const mixed = await Promise.all([
        settle(() => removeFromInventory(t.player.id, asset.id)),
        settle(() => addToInventory(t.player.id, asset.id)),
        settle(() => removeFromInventory(t.player.id, asset.id)),
      ]);
      const finalRow = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
      const finalUsage = calculateInventoryUsage(await assetsOf(t.player.id));
      check('C: sluttilstanden er entydig',
        (finalRow.storageLocation === 'INVENTORY' && finalUsage.usedSlots === 2) ||
          (finalRow.storageLocation === 'STORED' && finalUsage.usedSlots === 0),
        `${finalRow.storageLocation} / ${finalUsage.usedSlots}`);
      void mixed;
    }

    {
      // Scenario D: concurrent attempts on another player's asset.
      const victim = await createTestPlayer();
      const victimAsset = await giveAsset(victim.player.id, 'diamant');
      const thief = await createTestPlayer();

      const results = await burst(10, () =>
        settle(() => addToInventory(thief.player.id, victimAsset.id)),
      );
      check('D: alle forsøk avvises', results.every((r) => !r.ok));
      check('D: alle får ikke-funnet', results.every((r) => r.code === 'IKKE_FUNNET'),
        results.map((r) => r.code).join(','));
      check('D: offerets eiendel er uendret',
        (await prisma.asset.findUniqueOrThrow({ where: { id: victimAsset.id } }))
          .storageLocation === 'STORED');
      check('D: tyven eier fortsatt ingenting',
        (await assetsOf(thief.player.id)).length === 0);
    }

    /* ================================================================== */
    section('27. Rollback');

    {
      // A real constraint makes the write fail after the checks have passed.
      const t = await createTestPlayer();
      const asset = await giveAsset(t.player.id, 'laptop');

      await prisma.$executeRawUnsafe(
        `ALTER TABLE assets ADD CONSTRAINT qa_block_inventory
         CHECK ("storageLocation" <> 'INVENTORY') NOT VALID`,
      );

      let failed = false;
      try {
        const result = await settle(() => addToInventory(t.player.id, asset.id));
        failed = !result.ok;
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE assets DROP CONSTRAINT qa_block_inventory');
      }

      check('skrivingen feilet som forventet', failed);

      const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
      check('eiendelen er rullet tilbake', row.storageLocation === 'STORED',
        row.storageLocation);
      check('ingen plasser er brukt',
        calculateInventoryUsage(await assetsOf(t.player.id)).usedSlots === 0);

      // And it works again afterwards.
      const recovered = await settle(() => addToInventory(t.player.id, asset.id));
      check('fungerer igjen etterpå', recovered.ok, recovered.code);
    }

    /* ================================================================== */
    section('28. Tilgang og lekkasje');

    {
      const anonList = await get(server.base, '/inventar');
      const anonAdd = await post(server.base, '/inventar/legg-inn', {
        body: { assetId: 'x' },
      });
      check('liste uten sesjon gir 401', anonList.status === 401, String(anonList.status));
      check('innlegging uten sesjon gir 401', anonAdd.status === 401, String(anonAdd.status));

      const t = await createTestPlayer();
      const asset = await giveAsset(t.player.id, 'lommelykt');
      await post(server.base, '/inventar/legg-inn', {
        cookie: t.cookie,
        body: { assetId: asset.id },
      });

      const res = await get(server.base, '/inventar', { cookie: t.cookie });
      const raw = JSON.stringify(res.body);
      check('interne felter lekker ikke',
        !/playerId|assetTypeId|purchasePrice|maintenancePaidAt|updatedAt|purchasedAt|isTrue|passwordHash/.test(raw),
        raw.slice(0, 140));
      check('etikettene er norske',
        res.body.items[0].categoryLabel === 'Utstyr' &&
          res.body.items[0].statusLabel === 'Aktiv' &&
          res.body.items[0].storageLabel === 'I inventar');
      check('plasskostnaden følger med', res.body.items[0].inventorySlots === 1);
      check('stedsnavnet er norsk', res.body.items[0].locationName === 'Sentrum');

      // The exact rate-limit behaviour is asserted in test:ratelimit, which runs
      // in its own process with clean counters. Sharing a bucket across every
      // request this suite has already made would make the numbers meaningless.
    }

    /* ================================================================== */
    section('Sluttkontroll');

    {
      const overCapacity = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM (
           SELECT "playerId" FROM assets WHERE "storageLocation" = 'INVENTORY'
           GROUP BY "playerId"
         ) t`,
      );
      note(`spillere med noe i inventaret: ${overCapacity[0]?.count ?? 0}`);

      const rows = await prisma.asset.findMany({
        where: { storageLocation: 'INVENTORY' },
      });
      const perPlayer = new Map<string, number>();
      for (const row of rows) {
        perPlayer.set(
          row.playerId,
          (perPlayer.get(row.playerId) ?? 0) + inventorySlotsFor(row.assetTypeId),
        );
      }
      const over = [...perPlayer.entries()].filter(([, slots]) => slots > INVENTORY_CAPACITY);
      check('ingen spiller er over kapasitet', over.length === 0,
        over.map(([id, slots]) => `${id}:${slots}`).join(','));
      check('ingenting ikke-bærbart ligger i inventaret',
        rows.every((row) => isInventoryEligible(row.assetTypeId)));
    }
  } finally {
    await server.close();
    await prisma
      .$executeRawUnsafe('ALTER TABLE assets DROP CONSTRAINT IF EXISTS qa_block_inventory')
      .catch(() => undefined);
    await cleanup();
    await prisma.$disconnect();
  }

  const failed = summary();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma
    .$executeRawUnsafe('ALTER TABLE assets DROP CONSTRAINT IF EXISTS qa_block_inventory')
    .catch(() => undefined);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
