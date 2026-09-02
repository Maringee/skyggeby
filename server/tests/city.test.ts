/**
 * Integration tests for the city system, against the real PostgreSQL database.
 *
 * Run with `npm -w @skyggeby/server run test:city`.
 */
import {
  DEFAULT_DISTRICT_ID,
  DISTRICTS,
  districtModifiers,
  findDistrict,
  resolveDistrict,
} from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { performCrime } from '../src/modules/crime/crime.service';
import { moveToDistrict } from '../src/modules/city/city.service';
import { AppError } from '../src/lib/errors';
import {
  TEST_PREFIX,
  atLevel,
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

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1. Ny spiller starter i Sentrum');

    {
      const username = `${TEST_PREFIX}_reg`;
      const res = await post(server.base, '/auth/registrer', {
        body: { username, password: 'hemmelig123', confirmPassword: 'hemmelig123' },
      });

      check('registrering lykkes', res.status === 201, String(res.status));
      check(
        'svaret sier Sentrum',
        res.body?.player?.currentDistrictId === 'sentrum',
        res.body?.player?.currentDistrictId,
      );

      const row = await prisma.player.findUniqueOrThrow({
        where: { usernameLower: username.toLowerCase() },
      });
      check('databasen sier Sentrum', row.currentDistrictId === 'sentrum', row.currentDistrictId);
      check('standarden kommer fra katalogen', DEFAULT_DISTRICT_ID === 'sentrum');

      // A player created without an explicit district also lands in Sentrum.
      const t = await createTestPlayer();
      check('kolonnestandarden er Sentrum', t.player.currentDistrictId === 'sentrum');
    }

    /* ================================================================== */
    section('2. Gyldig flytting fungerer');

    {
      const t = await createTestPlayer();

      const res = await post(server.base, '/by/flytt', {
        cookie: t.cookie,
        body: { districtId: 'havna' },
      });

      check('flytting svarer 200', res.status === 200, String(res.status));
      check('moved er true', res.body?.moved === true);
      check('spilleren returneres oppdatert', res.body?.player?.currentDistrictId === 'havna');
      check('gjeldende distrikt følger med', res.body?.currentDistrictId === 'havna');
      check('meldingen er på norsk', res.body?.message === 'Du er nå i Havna.', res.body?.message);
      check(
        'kartet markerer riktig distrikt',
        res.body?.districts?.filter((d: any) => d.current).map((d: any) => d.id).join(',') ===
          'havna',
      );
      check('alle seks distrikter returneres', res.body?.districts?.length === 6);

      // Moving to where you already are is a no-op, not an error.
      const again = await post(server.base, '/by/flytt', {
        cookie: t.cookie,
        body: { districtId: 'havna' },
      });
      check('flytting til samme sted er ikke en feil', again.status === 200, String(again.status));
      check('moved er false', again.body?.moved === false);
      check(
        'meldingen forklarer det',
        again.body?.message === 'Du er allerede i Havna.',
        again.body?.message,
      );

      // Every district in the catalogue is reachable.
      let allReachable = true;
      for (const district of DISTRICTS) {
        const move = await post(server.base, '/by/flytt', {
          cookie: t.cookie,
          body: { districtId: district.id },
        });
        if (move.status !== 200 || move.body?.player?.currentDistrictId !== district.id) {
          allReachable = false;
        }
      }
      check('alle distrikter i katalogen kan nås', allReachable);
    }

    /* ================================================================== */
    section('3. Ugyldig districtId avvises');

    {
      const t = await createTestPlayer();
      const before = await reload(t.player.id);

      const cases: Array<{ label: string; body: unknown }> = [
        { label: 'ukjent id', body: { districtId: 'atlantis' } },
        { label: 'tom streng', body: { districtId: '' } },
        { label: 'tall', body: { districtId: 42 } },
        { label: 'objekt', body: { districtId: { id: 'havna' } } },
        { label: 'manglende felt', body: {} },
        { label: 'null', body: { districtId: null } },
        { label: 'nesten riktig', body: { districtId: 'Havna' } },
        { label: 'sql-aktig', body: { districtId: "havna'; DROP TABLE players;--" } },
      ];

      const results = await Promise.all(
        cases.map((c) => post(server.base, '/by/flytt', { cookie: t.cookie, body: c.body })),
      );

      results.forEach((res, i) => {
        check(
          `avvist: ${cases[i]!.label}`,
          res.status === 400,
          `${res.status} ${res.body?.error?.code ?? ''}`,
        );
      });

      check(
        'feilmeldingene er norske',
        results.every((r) => /distrikt|påkrevd|tekst|Feltet/i.test(r.body?.error?.message ?? '')),
        results.map((r) => r.body?.error?.message).join(' | '),
      );

      const after = await reload(t.player.id);
      check(
        'ingen av dem endret distriktet',
        after.currentDistrictId === before.currentDistrictId,
        after.currentDistrictId,
      );

      // The tables are still there after the injection-shaped input.
      const stillThere = await prisma.player.count();
      check('databasen er intakt', stillThere > 0);

      // Service layer rejects unknown ids too, not just the route.
      const direct = await settle(() => moveToDistrict(t.player.id, 'atlantis'));
      check('tjenestelaget avviser også', direct.code === 'IKKE_FUNNET', direct.code);

      const anon = await post(server.base, '/by/flytt', { body: { districtId: 'havna' } });
      check('uten sesjon gir 401', anon.status === 401, String(anon.status));
    }

    /* ================================================================== */
    section('4. Distriktet lagres korrekt');

    {
      const t = await createTestPlayer();

      for (const district of DISTRICTS) {
        await post(server.base, '/by/flytt', {
          cookie: t.cookie,
          body: { districtId: district.id },
        });
        const row = await reload(t.player.id);
        check(
          `${district.name} lagres i databasen`,
          row.currentDistrictId === district.id,
          row.currentDistrictId,
        );
      }

      // And it survives a fresh read through another endpoint.
      const city = await get(server.base, '/by', { cookie: t.cookie });
      const last = DISTRICTS[DISTRICTS.length - 1]!;
      check('GET /by gjenspeiler databasen', city.body?.currentDistrictId === last.id);
      check('profilen gjenspeiler databasen', (
        await get(server.base, '/spiller/profil', { cookie: t.cookie })
      ).body?.player?.currentDistrictId === last.id);
    }

    /* ================================================================== */
    section('5. Samtidige flytteforespørsler gir konsistent sluttstatus');

    {
      const t = await createTestPlayer();

      const [a, b] = await Promise.all([
        post(server.base, '/by/flytt', { cookie: t.cookie, body: { districtId: 'neon' } }),
        post(server.base, '/by/flytt', { cookie: t.cookie, body: { districtId: 'blokkene' } }),
      ]);

      check('begge svarer 200', a.status === 200 && b.status === 200, `${a.status}, ${b.status}`);

      const after = await reload(t.player.id);
      note(`endte i ${after.currentDistrictId}`);

      check(
        'sluttstatus er ett av de to distriktene',
        after.currentDistrictId === 'neon' || after.currentDistrictId === 'blokkene',
        after.currentDistrictId,
      );
      check(
        'sluttstatus er alltid gyldig',
        findDistrict(after.currentDistrictId) !== undefined,
        after.currentDistrictId,
      );

      // Ten simultaneous moves to different districts.
      const targets = DISTRICTS.map((d) => d.id);
      const results = await burst(12, (i) =>
        post(server.base, '/by/flytt', {
          cookie: t.cookie,
          body: { districtId: targets[i % targets.length] },
        }),
      );

      check('ingen av tolv feiler', results.every((r) => r.status === 200),
        results.map((r) => r.status).join(','));

      const final = await reload(t.player.id);
      check(
        'spilleren står i nøyaktig ett gyldig distrikt',
        findDistrict(final.currentDistrictId) !== undefined,
        final.currentDistrictId,
      );
      check(
        'siste svar stemmer med databasen for minst ett kall',
        results.some((r) => r.body?.player?.currentDistrictId === final.currentDistrictId),
      );
    }

    /* ================================================================== */
    section('6. Kriminalitet bruker distriktet som ligger i databasen');

    {
      const t = await createTestPlayer({ energy: 100 });

      // Written straight to the database, bypassing the API entirely.
      await prisma.player.update({
        where: { id: t.player.id },
        data: { currentDistrictId: 'blokkene' },
      });

      const res = await post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie });

      check('kriminaliteten går gjennom', res.status === 200, String(res.status));
      check(
        'utfallet peker på Blokkene',
        res.body?.outcome?.districtId === 'blokkene',
        res.body?.outcome?.districtId,
      );
      check('distriktsnavnet er norsk', res.body?.outcome?.districtName === 'Blokkene');
      check('svaret oppgir distriktet', res.body?.district?.districtId === 'blokkene');

      const attempt = await prisma.crimeAttempt.findFirstOrThrow({
        where: { playerId: t.player.id },
      });
      check('forsøket bokføres med distriktet', attempt.districtId === 'blokkene', attempt.districtId);

      // The visible numbers must differ between districts.
      const quiet = await createTestPlayer({ energy: 100, ...atLevel(18) });
      await prisma.player.update({
        where: { id: quiet.player.id },
        data: { currentDistrictId: 'blokkene' },
      });
      const guarded = await createTestPlayer({ energy: 100, ...atLevel(18) });
      await prisma.player.update({
        where: { id: guarded.player.id },
        data: { currentDistrictId: 'regjeringskvartalet' },
      });

      const quietList = await get(server.base, '/kriminalitet', { cookie: quiet.cookie });
      const guardedList = await get(server.base, '/kriminalitet', { cookie: guarded.cookie });

      const quietCrime = quietList.body.crimes.find((c: any) => c.id === 'lommetyveri');
      const guardedCrime = guardedList.body.crimes.find((c: any) => c.id === 'lommetyveri');

      note(
        `Blokkene: ${(quietCrime.successChance * 100).toFixed(1)} % / ${quietCrime.rewardMax} kr, ` +
          `Regjeringskvartalet: ${(guardedCrime.successChance * 100).toFixed(1)} % / ${guardedCrime.rewardMax} kr`,
      );

      check(
        'lite politi gir høyere sjanse',
        quietCrime.successChance > guardedCrime.successChance,
      );
      check(
        'høyere aktivitet gir høyere utbytte',
        quietCrime.rewardMax > guardedCrime.rewardMax,
        `${quietCrime.rewardMax} vs ${guardedCrime.rewardMax}`,
      );
      check(
        'katalogen oppgir hvilket distrikt tallene gjelder',
        quietList.body.district.districtId === 'blokkene' &&
          guardedList.body.district.districtId === 'regjeringskvartalet',
      );

      // Statistical: the modifier must actually change outcomes, not just text.
      const samples = 120;
      const runDistrict = async (districtId: string) => {
        let wins = 0;
        for (let i = 0; i < samples; i += 1) {
          const p = await createTestPlayer({ energy: 100 });
          await prisma.player.update({
            where: { id: p.player.id },
            data: { currentDistrictId: districtId },
          });
          const outcome = await performCrime(p.player.id, 'lommetyveri');
          if (outcome.outcome.success) wins += 1;
        }
        return wins / samples;
      };

      const quietRate = await runDistrict('blokkene');
      const guardedRate = await runDistrict('regjeringskvartalet');

      note(
        `suksess: Blokkene ${(quietRate * 100).toFixed(1)} %, ` +
          `Regjeringskvartalet ${(guardedRate * 100).toFixed(1)} %`,
      );
      check(
        'distriktet påvirker faktiske utfall',
        quietRate > guardedRate + 0.08,
        `${quietRate} vs ${guardedRate}`,
      );
    }

    /* ================================================================== */
    section('7. Manipulert distrikt fra klienten ignoreres');

    {
      const t = await createTestPlayer({ energy: 100 });
      await prisma.player.update({
        where: { id: t.player.id },
        data: { currentDistrictId: 'regjeringskvartalet' },
      });

      const forged = {
        districtId: 'blokkene',
        currentDistrictId: 'blokkene',
        district: { id: 'blokkene', policePresence: 1, risk: 1, activity: 5 },
        modifiers: { success: 10, payout: 100, heat: 0, xp: 100, fine: 0, healthLoss: 0 },
        successMultiplier: 10,
        payoutMultiplier: 100,
        policePresence: 1,
      };

      const res = await post(server.base, '/kriminalitet/lommetyveri', {
        cookie: t.cookie,
        body: forged,
      });

      check('forespørselen behandles normalt', res.status === 200, String(res.status));
      check(
        'serveren bruker distriktet fra databasen',
        res.body?.outcome?.districtId === 'regjeringskvartalet',
        res.body?.outcome?.districtId,
      );

      const after = await reload(t.player.id);
      check(
        'klienten flyttet ikke spilleren',
        after.currentDistrictId === 'regjeringskvartalet',
        after.currentDistrictId,
      );

      const outcome = res.body.outcome;
      const govMods = districtModifiers(resolveDistrict('regjeringskvartalet'));
      const maxPayout = Math.round(180 * govMods.payout);
      const maxXp = Math.round(14 * govMods.xp);

      check(
        'utbyttet er innenfor distriktets tak',
        outcome.payout <= maxPayout,
        `${outcome.payout} > ${maxPayout}`,
      );
      check('XP er innenfor distriktets tak', outcome.xpGained <= maxXp, `${outcome.xpGained}`);
      check(
        'ingen forfalsket multiplikator slo gjennom',
        after.cash <= 2500 + maxPayout && after.xp <= maxXp,
        `cash=${after.cash} xp=${after.xp}`,
      );

      const attempt = await prisma.crimeAttempt.findFirstOrThrow({
        where: { playerId: t.player.id },
      });
      check(
        'loggen viser det virkelige distriktet',
        attempt.districtId === 'regjeringskvartalet',
        attempt.districtId,
      );

      // The move endpoint ignores everything except a valid districtId.
      const mover = await createTestPlayer();
      const moveRes = await post(server.base, '/by/flytt', {
        cookie: mover.cookie,
        body: {
          districtId: 'neon',
          cash: 999_999,
          level: 99,
          xp: 999_999,
          energy: 999,
          heat: 0,
          policePresence: 1,
        },
      });
      check('flytting lykkes', moveRes.status === 200);
      const moved = await reload(mover.player.id);
      check('kun distriktet endret seg', moved.currentDistrictId === 'neon');
      check(
        'ingen andre verdier ble rørt',
        moved.cash === 2500 && moved.level === 1 && moved.xp === 0 && moved.energy === 100,
        `cash=${moved.cash} level=${moved.level} xp=${moved.xp} energi=${moved.energy}`,
      );
    }

    /* ================================================================== */
    section('8. Modifikatorene utledes av katalogen');

    {
      // Every district derives its modifiers from its three ratings, so a new
      // district cannot ship with an inconsistent set of bonuses.
      let consistent = true;
      const problems: string[] = [];

      for (const district of DISTRICTS) {
        const mods = districtModifiers(district);
        const values = Object.values(mods);

        if (values.some((v) => !Number.isFinite(v) || v < 0)) {
          consistent = false;
          problems.push(`${district.name}: ugyldig multiplikator`);
        }
        // Higher police must never help you.
        if (district.policePresence > 3 && mods.success >= 1) {
          consistent = false;
          problems.push(`${district.name}: politi gir ikke straff`);
        }
        if (district.policePresence < 3 && mods.heat >= 1) {
          consistent = false;
          problems.push(`${district.name}: lite politi gir ikke lavere heat`);
        }
      }

      check('alle distrikter har sammenhengende modifikatorer', consistent, problems.join('; '));

      const sentrum = districtModifiers(resolveDistrict('sentrum'));
      const blokkene = districtModifiers(resolveDistrict('blokkene'));
      const gov = districtModifiers(resolveDistrict('regjeringskvartalet'));
      const neon = districtModifiers(resolveDistrict('neon'));

      check('Blokkene er tryggest for heat', blokkene.heat < sentrum.heat && blokkene.heat < gov.heat);
      check('Regjeringskvartalet er hardest', gov.success < sentrum.success && gov.fine > sentrum.fine);
      check('Neon gir mest utbytte', DISTRICTS.every((d) => districtModifiers(d).payout <= neon.payout));

      // An unknown stored id must degrade to Sentrum, never crash.
      const orphan = await createTestPlayer({ energy: 100 });
      await prisma.player.update({
        where: { id: orphan.player.id },
        data: { currentDistrictId: 'et-distrikt-som-ble-fjernet' },
      });
      const res = await post(server.base, '/kriminalitet/lommetyveri', { cookie: orphan.cookie });
      check('ukjent lagret distrikt faller tilbake til Sentrum', res.status === 200, String(res.status));
      check('utfallet oppgir Sentrum', res.body?.outcome?.districtId === 'sentrum',
        res.body?.outcome?.districtId);
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
