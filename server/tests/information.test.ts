/**
 * Integration tests for the information system, against the real PostgreSQL
 * database and a real Express server.
 *
 * Run with `npm -w @skyggeby/server run test:information`.
 */
import {
  INFORMATION_BALANCE,
  INFORMATION_TUNING,
  informationBonusPoints,
  type InformationType,
} from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/errors';
import { performCrime } from '../src/modules/crime/crime.service';
import { exploreCurrentDistrict } from '../src/modules/information/information.service';
import {
  atLevel,
  burst,
  check,
  cleanup,
  createInformation,
  createTestPlayer,
  get,
  note,
  post,
  purgeStaleTestData,
  reload,
  reloadInformation,
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

/** Recursively collects every key name in a JSON structure. */
function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      allKeys(child, into);
    }
  }
  return into;
}

/** Explores until something is found, so tests do not depend on the dice. */
async function exploreUntilFound(playerId: string, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    // Clear the cooldown between attempts; the cooldown itself is tested apart.
    await prisma.player.update({
      where: { id: playerId },
      data: { lastExploredAt: null, energy: 100 },
    });
    const result = await exploreCurrentDistrict(playerId);
    if (result.found) return result.found;
  }
  return null;
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1. Utforskning bruker distriktet fra databasen');

    {
      const t = await createTestPlayer({ energy: 100 });
      await prisma.player.update({
        where: { id: t.player.id },
        // Written straight to the database, never through the API.
        data: { currentDistrictId: 'havna' },
      });

      const found = await exploreUntilFound(t.player.id);
      check('utforskning fant noe til slutt', found !== null);
      check('funnet er knyttet til Havna', found?.districtId === 'havna', String(found?.districtId));

      const listed = await get(server.base, '/informasjon', { cookie: t.cookie });
      check('svaret oppgir spillerens distrikt', listed.body?.districtId === 'havna');
      check('distriktsnavnet er norsk', listed.body?.districtName === 'Havna');
    }

    /* ================================================================== */
    section('2. Klienten kan ikke velge distrikt');

    {
      const t = await createTestPlayer({ energy: 100 });
      await prisma.player.update({
        where: { id: t.player.id },
        data: { currentDistrictId: 'industrien' },
      });

      // Every one of these is ignored; the server reads the locked row instead.
      const res = await post(server.base, '/informasjon/utforsk', {
        cookie: t.cookie,
        body: {
          districtId: 'neon',
          currentDistrictId: 'neon',
          district: { id: 'neon', activity: 5 },
        },
      });

      check('forespørselen behandles', res.status === 200, String(res.status));

      const rows = await prisma.information.findMany({ where: { ownerId: t.player.id } });
      check(
        'ingen informasjon havnet i Neon',
        rows.every((r) => r.districtId === 'industrien'),
        rows.map((r) => r.districtId).join(','),
      );

      const after = await reload(t.player.id);
      check('spilleren ble ikke flyttet', after.currentDistrictId === 'industrien');
    }

    /* ================================================================== */
    section('3. Utforskning koster riktig mengde energi');

    {
      const t = await createTestPlayer({ energy: 100 });
      const res = await post(server.base, '/informasjon/utforsk', { cookie: t.cookie });

      check('utforskning svarer 200', res.status === 200, String(res.status));
      check(
        'svaret oppgir energikostnaden',
        res.body?.energySpent === INFORMATION_TUNING.exploreEnergyCost,
        String(res.body?.energySpent),
      );

      const after = await reload(t.player.id);
      check('nøyaktig 3 energi trukket', after.energy === 97, `energi=${after.energy}`);
      check(
        'å lete gir erfaring',
        after.xp === INFORMATION_TUNING.exploreXp,
        `xp=${after.xp}`,
      );
      check(
        'svaret oppgir erfaringen',
        res.body?.xpGained === INFORMATION_TUNING.exploreXp,
        `${res.body?.xpGained}`,
      );
      check('kostnaden er den sentrale konstanten', INFORMATION_TUNING.exploreEnergyCost === 3);

      const broke = await createTestPlayer({ energy: 2 });
      const denied = await post(server.base, '/informasjon/utforsk', { cookie: broke.cookie });
      check('for lite energi avvises', denied.status === 400, String(denied.status));
      check(
        'feilmeldingen er norsk',
        /ikke nok energi/i.test(denied.body?.error?.message ?? ''),
        denied.body?.error?.message,
      );
      check('avvist forsøk koster ingenting', (await reload(broke.player.id)).energy === 2);
    }

    /* ================================================================== */
    section('4. Avkjøling blokkerer ny utforskning');

    {
      const t = await createTestPlayer({ energy: 100 });

      const first = await post(server.base, '/informasjon/utforsk', { cookie: t.cookie });
      check('første utforskning går gjennom', first.status === 200, String(first.status));
      check(
        'avkjølingen returneres',
        first.body?.exploreCooldownSeconds > 0 &&
          first.body?.exploreCooldownSeconds <= INFORMATION_TUNING.exploreCooldownSeconds,
        String(first.body?.exploreCooldownSeconds),
      );

      const second = await post(server.base, '/informasjon/utforsk', { cookie: t.cookie });
      check('andre utforskning blokkeres', second.status === 429, String(second.status));
      check(
        'blokkeringen er avkjøling',
        second.body?.error?.code === 'AVKJOLING_AKTIV',
        second.body?.error?.code,
      );
      check(
        'meldingen er norsk',
        /Du må vente/.test(second.body?.error?.message ?? ''),
        second.body?.error?.message,
      );

      const after = await reload(t.player.id);
      check('blokkert forsøk koster ikke energi', after.energy === 97, `energi=${after.energy}`);
      check('avkjølingen varer to minutter', INFORMATION_TUNING.exploreCooldownSeconds === 120);
    }

    /* ================================================================== */
    section('5. Tolv samtidige utforskninger');

    {
      const t = await createTestPlayer({ energy: 100 });

      const results = await burst(12, () => settle(() => exploreCurrentDistrict(t.player.id)));
      const ok = results.filter((r) => r.ok);
      const blocked = results.filter((r) => r.code === 'AVKJOLING_AKTIV');
      const other = results.filter((r) => !r.ok && r.code !== 'AVKJOLING_AKTIV');

      note(`ok=${ok.length} avkjøling=${blocked.length} andre=${other.length}`);

      check('nøyaktig én lykkes', ok.length === 1, `${ok.length} lyktes`);
      check('resten blokkeres av avkjøling', blocked.length === 11);
      check('ingen uventede feil', other.length === 0, other.map((r) => r.code).join(','));

      const after = await reload(t.player.id);
      check('energi er aldri negativ', after.energy >= 0, `energi=${after.energy}`);
      check('kun én betaling trukket', after.energy === 97, `energi=${after.energy}`);

      const rows = await prisma.information.count({ where: { ownerId: t.player.id } });
      check('høyst én informasjon opprettet', rows <= 1, `${rows} rader`);
    }

    /* ================================================================== */
    section('6. Informasjon lagres med riktig eier');

    {
      const owner = await createTestPlayer({ energy: 100 });
      const stranger = await createTestPlayer({ energy: 100 });

      const found = await exploreUntilFound(owner.player.id);
      check('informasjon ble opprettet', found !== null);
      check('eieren er riktig', found?.ownerId === owner.player.id);

      const ownerList = await get(server.base, '/informasjon', { cookie: owner.cookie });
      const strangerList = await get(server.base, '/informasjon', { cookie: stranger.cookie });

      check('eieren ser sin egen informasjon', ownerList.body.information.length >= 1);
      check(
        'andre ser den ikke',
        strangerList.body.information.every((i: any) => i.id !== found?.id),
      );

      const direct = await get(server.base, `/informasjon/${found?.id}`, {
        cookie: stranger.cookie,
      });
      check('oppslag på fremmed id gir 404', direct.status === 404, String(direct.status));

      const own = await get(server.base, `/informasjon/${found?.id}`, { cookie: owner.cookie });
      check('eieren får den ved oppslag', own.status === 200, String(own.status));
    }

    /* ================================================================== */
    section('7. Pålitelighet holder seg i 0-100');

    {
      const t = await createTestPlayer({ energy: 100 });
      for (let i = 0; i < 25; i += 1) await exploreUntilFound(t.player.id, 3);

      const rows = await prisma.information.findMany({ where: { ownerId: t.player.id } });
      note(`kontrollerte ${rows.length} genererte rader`);

      check(
        'alle er innenfor 0-100',
        rows.every((r) => r.reliability >= 0 && r.reliability <= 100),
        rows.map((r) => r.reliability).join(','),
      );
      check(
        'alle holder seg innenfor typens spenn',
        rows.every((r) => {
          const balance = INFORMATION_BALANCE[r.type as InformationType];
          return (
            r.reliability >= balance.reliability.min && r.reliability <= balance.reliability.max
          );
        }),
      );

      // The database refuses an out-of-range value no matter who writes it.
      const tooHigh = await settle(() => createInformation(t.player.id, { reliability: 140 }));
      const negative = await settle(() => createInformation(t.player.id, { reliability: -5 }));
      check('databasen avviser 140', !tooHigh.ok, 'ble godtatt');
      check('databasen avviser -5', !negative.ok, 'ble godtatt');
    }

    /* ================================================================== */
    section('8. Intern sannhet lekker aldri til klienten');

    {
      const t = await createTestPlayer({ energy: 100, ...atLevel(18) });
      await createInformation(t.player.id, { isTrue: true });
      await createInformation(t.player.id, { isTrue: false, relevance: 'POLITI' });

      const responses = [
        await get(server.base, '/informasjon', { cookie: t.cookie }),
        await post(server.base, '/informasjon/utforsk', { cookie: t.cookie }),
        await post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie }),
      ];

      const list = await get(server.base, '/informasjon', { cookie: t.cookie });
      const single = await get(
        server.base,
        `/informasjon/${list.body.information[0].id}`,
        { cookie: t.cookie },
      );
      responses.push(single);

      let leaked: string[] = [];
      for (const res of responses) {
        const keys = allKeys(res.body);
        for (const key of ['isTrue', 'true', 'sann', 'truth']) {
          if (keys.has(key)) leaked.push(key);
        }
        if (JSON.stringify(res.body).includes('"isTrue"')) leaked.push('rå isTrue');
      }

      check('ingen respons inneholder sannhetsflagget', leaked.length === 0, leaked.join(','));
      check(
        'listesvaret har forventede felter',
        typeof list.body.information[0].reliability === 'number' &&
          typeof list.body.information[0].freshness === 'string',
      );
      check(
        'sannheten finnes fortsatt i databasen',
        (await prisma.information.count({ where: { ownerId: t.player.id, isTrue: false } })) >= 1,
      );
    }

    /* ================================================================== */
    section('9. Utløp og ferskhet beregnes på serveren');

    {
      const t = await createTestPlayer({ energy: 100 });
      const found = await exploreUntilFound(t.player.id);

      check('utløpstidspunkt settes ved oppdagelse', found?.expiresAt !== null);
      check(
        'utløpet stemmer med typens levetid',
        (() => {
          if (!found?.expiresAt) return false;
          const minutes =
            (found.expiresAt.getTime() - found.discoveredAt.getTime()) / 60000;
          return (
            Math.abs(minutes - INFORMATION_BALANCE[found.type as InformationType].lifetimeMinutes) <
            1
          );
        })(),
      );

      const fresh = await createInformation(t.player.id, {
        discoveredAt: new Date(Date.now() - 60 * 1000),
        expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
      });
      const old = await createInformation(t.player.id, {
        discoveredAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });
      const expired = await createInformation(t.player.id, {
        discoveredAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      const list = await get(server.base, '/informasjon', { cookie: t.cookie });
      const byId = new Map(list.body.information.map((i: any) => [i.id, i]));

      check('fersk merkes FERSK', (byId.get(fresh.id) as any)?.freshness === 'FERSK',
        (byId.get(fresh.id) as any)?.freshness);
      check('eldre merkes GAMMEL', (byId.get(old.id) as any)?.freshness === 'GAMMEL',
        (byId.get(old.id) as any)?.freshness);
      check('utløpt merkes UTDATERT', (byId.get(expired.id) as any)?.freshness === 'UTDATERT',
        (byId.get(expired.id) as any)?.freshness);
      check(
        'verdien faller med alderen',
        (byId.get(fresh.id) as any).currentValue > (byId.get(expired.id) as any).currentValue,
      );
      check(
        'etikettene er norske',
        (byId.get(expired.id) as any).freshnessLabel === 'Utdatert',
      );
    }

    /* ================================================================== */
    section('10. Utdatert informasjon gir ingen fordel');

    {
      const t = await createTestPlayer({ energy: 100, ...atLevel(18) });
      const expired = await createInformation(t.player.id, {
        relevance: 'SIKKERHET',
        reliability: 95,
        isTrue: true,
        discoveredAt: new Date(Date.now() - 10 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });

      const result = await performCrime(t.player.id, 'innbrudd');
      check('kriminaliteten kjørte', result.outcome.crimeId === 'innbrudd');
      check('ingen informasjon ble brukt', result.outcome.information === null);

      const after = await reloadInformation(expired.id);
      check('den utdaterte informasjonen er fortsatt ubrukt', after.usedAt === null);

      check(
        'bonusfunksjonen gir 0 for utdatert',
        informationBonusPoints({
          type: 'ETTERRETNING',
          reliability: 100,
          freshness: 'UTDATERT',
        }) === 0,
      );
    }

    /* ================================================================== */
    section('11. Høy pålitelighet gir større fordel enn lav');

    {
      const high = informationBonusPoints({
        type: 'ETTERRETNING',
        reliability: 95,
        freshness: 'FERSK',
      });
      const low = informationBonusPoints({
        type: 'ETTERRETNING',
        reliability: 30,
        freshness: 'FERSK',
      });
      note(`høy=${high} lav=${low} prosentpoeng`);
      check('høy pålitelighet gir mer', high > low, `${high} vs ${low}`);
      check('gammel informasjon gir mindre enn fersk',
        informationBonusPoints({ type: 'ETTERRETNING', reliability: 95, freshness: 'GAMMEL' }) <
          high);

      // And it shows up in the recorded odds of a real attempt.
      const strong = await createTestPlayer({ energy: 100, ...atLevel(18) });
      await createInformation(strong.player.id, {
        relevance: 'SIKKERHET',
        type: 'ETTERRETNING',
        reliability: 95,
        isTrue: true,
      });
      const weak = await createTestPlayer({ energy: 100, ...atLevel(18) });
      await createInformation(weak.player.id, {
        relevance: 'SIKKERHET',
        type: 'RYKTE',
        reliability: 25,
        isTrue: true,
      });

      await performCrime(strong.player.id, 'innbrudd');
      await performCrime(weak.player.id, 'innbrudd');

      const strongAttempt = await prisma.crimeAttempt.findFirstOrThrow({
        where: { playerId: strong.player.id },
      });
      const weakAttempt = await prisma.crimeAttempt.findFirstOrThrow({
        where: { playerId: weak.player.id },
      });

      note(
        `sjanse med sterk info: ${strongAttempt.chanceBps / 100} %, ` +
          `med svak: ${weakAttempt.chanceBps / 100} %`,
      );
      check(
        'sterk informasjon gir bedre odds i praksis',
        strongAttempt.chanceBps > weakAttempt.chanceBps,
        `${strongAttempt.chanceBps} vs ${weakAttempt.chanceBps}`,
      );
      check(
        'bonusen bokføres på forsøket',
        strongAttempt.informationBonus > weakAttempt.informationBonus,
      );
    }

    /* ================================================================== */
    section('12. Maksimal bonus kan ikke overskrides');

    {
      const ceiling = INFORMATION_TUNING.maxBonusPercentagePoints;

      const absurd = [
        informationBonusPoints({ type: 'ETTERRETNING', reliability: 10_000, freshness: 'FERSK' }),
        informationBonusPoints({ type: 'HEMMELIGHET', reliability: 999, freshness: 'FERSK' }),
        informationBonusPoints({ type: 'HEMMELIGHET', reliability: 100, freshness: 'FERSK' }),
      ];
      note(`maks observert: ${Math.max(...absurd)} av tak ${ceiling}`);

      check('ingen inndata bryter taket', absurd.every((b) => b <= ceiling), absurd.join(','));
      check('negativ pålitelighet gir ikke negativ bonus',
        informationBonusPoints({ type: 'RYKTE', reliability: -500, freshness: 'FERSK' }) === 0);
      check('taket er 15 prosentpoeng', ceiling === 15);

      // And the applied chance still respects the crime ceiling on top of it.
      const t = await createTestPlayer({ energy: 100 });
      await createInformation(t.player.id, {
        relevance: 'AKTIVITET',
        type: 'ETTERRETNING',
        reliability: 100,
        isTrue: true,
      });
      await performCrime(t.player.id, 'lommetyveri');

      const attempt = await prisma.crimeAttempt.findFirstOrThrow({
        where: { playerId: t.player.id },
      });
      check(
        'bokført bonus er innenfor taket',
        attempt.informationBonus <= ceiling * 10,
        String(attempt.informationBonus),
      );
      check(
        'sjansen overstiger aldri kriminalitetstaket',
        attempt.chanceBps <= 9500,
        String(attempt.chanceBps),
      );
    }

    /* ================================================================== */
    section('13. Brukt informasjon kan ikke brukes igjen');

    {
      const t = await createTestPlayer({ energy: 100, ...atLevel(18) });
      const info = await createInformation(t.player.id, {
        relevance: 'SIKKERHET',
        reliability: 90,
        isTrue: true,
      });

      const first = await performCrime(t.player.id, 'butikktyveri');
      check('informasjonen ble brukt', first.outcome.information?.information.id === info.id);

      const used = await reloadInformation(info.id);
      check('usedAt settes', used.usedAt !== null);
      check('jobben bokføres på informasjonen', used.usedOnCrimeId === 'butikktyveri');

      // A different crime with overlapping relevance must not find it again.
      const second = await performCrime(t.player.id, 'innbrudd');
      check('den kan ikke brukes på nytt', second.outcome.information === null);

      const stillUsed = await reloadInformation(info.id);
      check(
        'usedAt er uendret',
        stillUsed.usedAt?.getTime() === used.usedAt?.getTime(),
      );
      check('den vises som brukt i API-et', (
        await get(server.base, `/informasjon/${info.id}`, { cookie: t.cookie })
      ).body?.information?.used === true);
    }

    /* ================================================================== */
    section('14. Samtidige jobber kan ikke bruke samme informasjon');

    {
      const t = await createTestPlayer({ energy: 100, ...atLevel(18) });
      const info = await createInformation(t.player.id, {
        relevance: 'SIKKERHET',
        reliability: 90,
        isTrue: true,
      });

      // Four different jobs, all of which SIKKERHET is relevant to.
      const crimes = ['butikktyveri', 'innbrudd', 'bilkapring', 'lagerinnbrudd'];
      const results = await burst(crimes.length, (i) =>
        settle(() => performCrime(t.player.id, crimes[i]!)),
      );

      const withInfo = results.filter((r) => r.ok && r.value?.outcome.information);
      note(`${results.filter((r) => r.ok).length} jobber kjørte, ${withInfo.length} brukte info`);

      check('kun én jobb fikk informasjonen', withInfo.length === 1, `${withInfo.length}`);

      const after = await reloadInformation(info.id);
      check('informasjonen er brukt nøyaktig én gang', after.usedAt !== null);

      const attempts = await prisma.crimeAttempt.findMany({
        where: { playerId: t.player.id, informationId: info.id },
      });
      check('kun ett forsøk refererer til den', attempts.length === 1, `${attempts.length}`);
      check(
        'de andre forsøkene fikk ingen bonus',
        (
          await prisma.crimeAttempt.findMany({
            where: { playerId: t.player.id, informationId: null },
          })
        ).every((a) => a.informationBonus === 0),
      );
    }

    /* ================================================================== */
    section('15. Manipulerte klientfelter ignoreres');

    {
      const victim = await createTestPlayer();
      const t = await createTestPlayer({ energy: 100, ...atLevel(18) });
      await prisma.player.update({
        where: { id: t.player.id },
        data: { currentDistrictId: 'regjeringskvartalet' },
      });

      const forged = {
        reliability: 100,
        baseValue: 999_999,
        value: 999_999,
        isTrue: true,
        districtId: 'blokkene',
        source: 'ETTERFORSKNING',
        type: 'HEMMELIGHET',
        relevance: 'MULIGHET',
        usedAt: null,
        ownerId: victim.player.id,
        freshness: 'FERSK',
        expiresAt: new Date(Date.now() + 999 * 60 * 60 * 1000).toISOString(),
        modifiers: { success: 10, bonus: 100 },
        bonus: 100,
      };

      const res = await post(server.base, '/informasjon/utforsk', {
        cookie: t.cookie,
        body: forged,
      });
      check('forespørselen behandles normalt', res.status === 200, String(res.status));

      const rows = await prisma.information.findMany({ where: { ownerId: t.player.id } });
      check(
        'ingenting havnet hos den andre spilleren',
        (await prisma.information.count({ where: { ownerId: victim.player.id } })) === 0,
      );
      check('eieren er den innloggede spilleren', rows.every((r) => r.ownerId === t.player.id));
      check(
        'distriktet er spillerens faktiske',
        rows.every((r) => r.districtId === 'regjeringskvartalet'),
        rows.map((r) => r.districtId).join(','),
      );
      check(
        'påliteligheten er serverens, ikke 100',
        rows.every((r) => {
          const balance = INFORMATION_BALANCE[r.type as InformationType];
          return (
            r.reliability >= balance.reliability.min && r.reliability <= balance.reliability.max
          );
        }),
      );
      check(
        'verdien er serverens, ikke 999 999',
        rows.every((r) => r.baseValue < 10_000),
        rows.map((r) => r.baseValue).join(','),
      );
      check('ingenting er markert brukt', rows.every((r) => r.usedAt === null));

      // The same on the crime endpoint. A fresh player, because the exploration
      // above may have produced information of its own - the server always
      // picks the most useful piece it can find, so the assertion below is only
      // exact when there is exactly one candidate.
      const crimePlayer = await createTestPlayer({ energy: 100, ...atLevel(18) });
      await prisma.player.update({
        where: { id: crimePlayer.player.id },
        data: { currentDistrictId: 'regjeringskvartalet' },
      });
      const info = await createInformation(crimePlayer.player.id, {
        relevance: 'SIKKERHET',
        type: 'RYKTE',
        reliability: 30,
        isTrue: true,
        districtId: 'regjeringskvartalet',
      });

      const crimeRes = await post(server.base, '/kriminalitet/innbrudd', {
        cookie: crimePlayer.cookie,
        body: {
          informationId: 'finnes-ikke',
          information: { reliability: 100, isTrue: true, bonus: 100 },
          reliability: 100,
          bonus: 100,
          informationBonus: 999,
        },
      });
      check('jobben behandles normalt', crimeRes.status === 200, String(crimeRes.status));

      const candidates = await prisma.information.count({
        where: { ownerId: crimePlayer.player.id },
      });
      check('spilleren har nøyaktig én kandidat', candidates === 1, `${candidates}`);

      const attempt = await prisma.crimeAttempt.findFirstOrThrow({
        where: { playerId: crimePlayer.player.id },
        orderBy: { createdAt: 'desc' },
      });
      const expected = informationBonusPoints({
        type: 'RYKTE',
        reliability: 30,
        freshness: 'FERSK',
      });
      check(
        'bonusen er serverens beregning',
        attempt.informationBonus === Math.round(expected * 10),
        `${attempt.informationBonus} vs ${Math.round(expected * 10)}`,
      );
      check('den forfalskede bonusen ble ignorert', attempt.informationBonus < 999);
      void info;
    }

    /* ================================================================== */
    section('16. Rollback: mislykket jobb frigir informasjonen');

    {
      // A payout that would breach the wealth ceiling aborts the transaction
      // after the information has already been claimed inside it.
      let sawRollback = false;

      for (let i = 0; i < 25 && !sawRollback; i += 1) {
        const t = await createTestPlayer({ energy: 100, cash: 2_000_000_000 });
        const info = await createInformation(t.player.id, {
          relevance: 'AKTIVITET',
          reliability: 90,
          isTrue: true,
        });

        const result = await settle(() => performCrime(t.player.id, 'lommetyveri'));
        if (!result.ok && result.code === 'TAK_NADD') {
          sawRollback = true;
          const after = await reloadInformation(info.id);
          check('informasjonen er fortsatt ubrukt etter rollback', after.usedAt === null,
            String(after.usedAt));
          check('ingen jobb ble bokført', (
            await prisma.crimeAttempt.count({ where: { playerId: t.player.id } })
          ) === 0);
          check('energien er urørt', (await reload(t.player.id)).energy === 100);
        }
      }

      check('klarte å framprovosere en avbrutt jobb', sawRollback);
    }

    /* ================================================================== */
    section('17. Rollback: mislykket generering ruller tilbake energien');

    {
      const t = await createTestPlayer({ energy: 100 });
      const before = await reload(t.player.id);

      // A real constraint, added to the real table, so the insert genuinely
      // fails after the energy has already been written in the transaction.
      // NOT VALID keeps existing rows untouched and applies only to new ones.
      await prisma.$executeRawUnsafe(
        'ALTER TABLE information ADD CONSTRAINT qa_force_fail CHECK (false) NOT VALID',
      );

      let failed = false;
      try {
        // Repeat until a discovery is actually attempted; a fruitless search
        // never reaches the insert.
        for (let i = 0; i < 30 && !failed; i += 1) {
          await prisma.player.update({
            where: { id: t.player.id },
            data: { lastExploredAt: null, energy: 100 },
          });
          const result = await settle(() => exploreCurrentDistrict(t.player.id));
          if (!result.ok) failed = true;
        }
      } finally {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE information DROP CONSTRAINT qa_force_fail',
        );
      }

      check('genereringen feilet som forventet', failed);

      const after = await reload(t.player.id);
      check('energien er rullet tilbake', after.energy === 100, `energi=${after.energy}`);
      check('avkjølingen ble ikke satt', after.lastExploredAt === null, String(after.lastExploredAt));
      check(
        'ingen informasjon ble lagret',
        (await prisma.information.count({ where: { ownerId: t.player.id } })) === 0,
      );
      void before;

      // The table works again afterwards.
      const recovered = await exploreUntilFound(t.player.id, 20);
      check('utforskning fungerer igjen etterpå', recovered !== null);
    }

    /* ================================================================== */
    section('18. Tilgang og feilhåndtering');

    {
      const anonList = await get(server.base, '/informasjon');
      const anonExplore = await post(server.base, '/informasjon/utforsk');
      check('liste uten sesjon gir 401', anonList.status === 401, String(anonList.status));
      check('utforskning uten sesjon gir 401', anonExplore.status === 401,
        String(anonExplore.status));

      const t = await createTestPlayer({ energy: 100 });
      const missing = await get(server.base, '/informasjon/finnes-ikke', { cookie: t.cookie });
      check('ukjent id gir 404', missing.status === 404, String(missing.status));
      check(
        'feilmeldingen er norsk',
        missing.body?.error?.message === 'Fant ikke denne informasjonen.',
        missing.body?.error?.message,
      );

      const empty = await get(server.base, '/informasjon', { cookie: t.cookie });
      check('tom liste er gyldig', Array.isArray(empty.body?.information));
      check('energikostnaden oppgis', empty.body?.exploreEnergyCost === 3);
      check('avkjølingen starter på 0', empty.body?.exploreCooldownSeconds === 0);
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
  await prisma
    .$executeRawUnsafe('ALTER TABLE information DROP CONSTRAINT IF EXISTS qa_force_fail')
    .catch(() => undefined);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
