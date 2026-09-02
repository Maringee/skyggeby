/**
 * Integration tests for player profiles and player search, against the real
 * PostgreSQL database and a real Express server.
 *
 * The point of most of these is negative: proving that a public profile cannot
 * be made to carry cash, health, heat, skill points or anything else that
 * belongs to the player alone, no matter how the request is shaped.
 *
 * Run with `npm -w @skyggeby/server run test:profile`.
 */
import { PLAYER_SEARCH, resolveDistrict } from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { buyAsset } from '../src/modules/assets/asset.service';
import { buyBusiness } from '../src/modules/businesses/business.service';
import { sendMessage } from '../src/modules/messages/message.service';
import {
  findPublicProfile,
  searchPlayers,
} from '../src/modules/players/profile.service';
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
  TEST_PREFIX,
} from './harness';

/** Every field a public profile must never carry, by name and by value. */
const FORBIDDEN_KEYS = [
  'cash',
  'bankBalance',
  'health',
  'heat',
  'skillPoints',
  'passwordHash',
  'usernameLower',
  'energy',
  'maxEnergy',
  'energyUpdatedAt',
  'heatUpdatedAt',
  'lastExploredAt',
  'lastSeenAt',
  'updatedAt',
  'token',
  'sessions',
  'messages',
  'contacts',
  'information',
  'transactions',
];

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1. Offentlig profil');

    {
      const owner = await createTestPlayer({
        cash: 1234567,
        bankBalance: 76543,
        health: 61,
        heat: 42,
        skillPoints: 7,
        reputation: 1500,
        level: 4,
        xp: 900,
        currentDistrictId: 'blokkene',
      });
      const viewer = await createTestPlayer();

      const res = await get(server.base, `/spillere/${owner.player.username}`, {
        cookie: viewer.cookie,
      });

      check('profilen svarer 200', res.status === 200, String(res.status));

      const profile = res.body?.profile;
      check('brukernavnet er med', profile?.username === owner.player.username);
      check('nivået er med', profile?.level === 4, `${profile?.level}`);
      check('XP er med', profile?.xp === 900, `${profile?.xp}`);
      check('rykte er med', profile?.reputation === 1500, `${profile?.reputation}`);
      check(
        'ryktebetegnelsen er norsk',
        profile?.reputationLabel === 'Etablert',
        profile?.reputationLabel,
      );
      check('distriktet er med', profile?.districtId === 'blokkene');
      check(
        'distriktsnavnet kommer fra katalogen',
        profile?.districtName === resolveDistrict('blokkene').name,
        profile?.districtName,
      );
      check('medlem siden er med', typeof profile?.memberSince === 'string');
      check('virksomheter telles', profile?.businessCount === 0, `${profile?.businessCount}`);
      check('eiendeler telles', profile?.assetCount === 0, `${profile?.assetCount}`);
      check('det er ikke en selv', profile?.isSelf === false);

      const keys = Object.keys(profile).sort();
      check(
        'profilen har nøyaktig de feltene den skal',
        JSON.stringify(keys) ===
          JSON.stringify([
            'assetCount',
            'businessCount',
            'districtId',
            'districtName',
            'id',
            'isSelf',
            'level',
            'memberSince',
            'reputation',
            'reputationLabel',
            'username',
            'xp',
          ]),
        keys.join(','),
      );

      const blob = JSON.stringify(res.body);
      for (const field of FORBIDDEN_KEYS) {
        check(`${field} lekker ikke`, !blob.includes(field));
      }
      // Distinctive enough that a substring hit would mean a real leak.
      for (const [name, value] of [
        ['kontanter', '1234567'],
        ['bank', '76543'],
      ] as const) {
        check(`verdien for ${name} lekker ikke`, !blob.includes(value), value);
      }

      // Small numbers would collide with ids and timestamps by chance, so
      // these are checked against the actual values the profile carries.
      const values = Object.values(profile);
      for (const [name, value] of [
        ['helse', 61],
        ['heat', 42],
        ['ferdighetspoeng', 7],
      ] as const) {
        check(
          `verdien for ${name} er ikke et felt i profilen`,
          !values.includes(value),
          `${value}`,
        );
      }
    }

    /* ================================================================== */
    section('2. Egen profil');

    {
      const me = await createTestPlayer({ cash: 500 });

      const res = await get(server.base, `/spillere/${me.player.username}`, {
        cookie: me.cookie,
      });
      check('egen profil svarer 200', res.status === 200, String(res.status));
      check('den er markert som ens egen', res.body?.profile?.isSelf === true);
      check(
        'egen profil lekker heller ikke kontanter',
        !JSON.stringify(res.body).includes('cash'),
      );

      // The private view is the existing endpoint, unchanged.
      const own = await get(server.base, '/spiller/profil', { cookie: me.cookie });
      check('den private profilen svarer fortsatt 200', own.status === 200);
      check('og der er kontantene med', own.body?.player?.cash === 500, `${own.body?.player?.cash}`);
      check('og heat', typeof own.body?.player?.heat === 'number');
      check('og ferdighetspoeng', typeof own.body?.player?.skillPoints === 'number');
      check(
        'men aldri passordhashen',
        !JSON.stringify(own.body).includes('passwordHash'),
      );
    }

    /* ================================================================== */
    section('3. Brukernavn uten hensyn til store bokstaver');

    {
      const owner = await createTestPlayer();
      const viewer = await createTestPlayer();
      const name = owner.player.username;

      const variants = [name, name.toUpperCase(), name.toLowerCase(), `  ${name}  `];

      for (const variant of variants) {
        const res = await get(
          server.base,
          `/spillere/${encodeURIComponent(variant)}`,
          { cookie: viewer.cookie },
        );
        check(
          `"${variant.trim() === name ? variant : variant}" finner spilleren`,
          res.status === 200 && res.body?.profile?.username === name,
          `${res.status}`,
        );
      }

      check(
        'tjenesten finner den samme raden uansett skrivemåte',
        (await findPublicProfile(name.toUpperCase())).id === owner.player.id,
      );
    }

    /* ================================================================== */
    section('4. Ukjent spiller');

    {
      const viewer = await createTestPlayer();

      const cases = [
        'finnesikke',
        'ingen_slik_spiller',
        'x'.repeat(60),
        '../../etc/passwd',
        "' OR 1=1 --",
        '<script>alert(1)</script>',
      ];

      for (const name of cases) {
        const res = await get(server.base, `/spillere/${encodeURIComponent(name)}`, {
          cookie: viewer.cookie,
        });
        check(`"${name.slice(0, 20)}" gir 404`, res.status === 404, String(res.status));
        check(
          `"${name.slice(0, 20)}": meldingen er norsk`,
          res.body?.error?.message === 'Fant ikke denne spilleren.',
          res.body?.error?.message,
        );
      }

      // An id is not a name: knowing one buys nothing.
      const other = await createTestPlayer({ cash: 999 });
      const byId = await get(server.base, `/spillere/${other.player.id}`, {
        cookie: viewer.cookie,
      });
      check('en intern id fungerer ikke som brukernavn', byId.status === 404, String(byId.status));
      check('og lekker ingenting', !JSON.stringify(byId.body ?? {}).includes('999'));
    }

    /* ================================================================== */
    section('5. Statistikk beregnes på serveren');

    {
      const owner = await createTestPlayer({ cash: 2000000 });
      const viewer = await createTestPlayer();

      await buyBusiness(owner.player.id, 'verksted', 'Tellverket');
      await buyBusiness(owner.player.id, 'naerbutikk', 'Tellbutikken');
      await buyAsset(owner.player.id, 'moped');
      await buyAsset(owner.player.id, 'laptop');
      await buyAsset(owner.player.id, 'gullkjede');

      const res = await get(server.base, `/spillere/${owner.player.username}`, {
        cookie: viewer.cookie,
      });

      check('to virksomheter telles', res.body?.profile?.businessCount === 2,
        `${res.body?.profile?.businessCount}`);
      check('tre eiendeler telles', res.body?.profile?.assetCount === 3,
        `${res.body?.profile?.assetCount}`);

      const blob = JSON.stringify(res.body);
      for (const detail of [
        'Tellverket',
        'Tellbutikken',
        'purchasePrice',
        'incomePerDay',
        'cashBalance',
        'condition',
        'risk',
        'moped',
        'laptop',
      ]) {
        check(`detaljen "${detail}" er ikke med`, !blob.includes(detail));
      }

      // Nothing the client sends can change what is counted.
      const manipulated = await get(
        server.base,
        `/spillere/${owner.player.username}?businessCount=99&assetCount=99&cash=5&level=99&includePrivate=true&select=*`,
        { cookie: viewer.cookie },
      );
      check('manipulerte query-parametre ignoreres', manipulated.body?.profile?.businessCount === 2);
      check('nivået kan ikke overstyres', manipulated.body?.profile?.level === res.body.profile.level);
      check(
        'og ingenting privat kom med',
        !JSON.stringify(manipulated.body).includes('cash'),
      );
    }

    /* ================================================================== */
    section('6. Distriktet leses fra databasen');

    {
      const owner = await createTestPlayer({ currentDistrictId: 'neon' });
      const viewer = await createTestPlayer();

      const before = await get(server.base, `/spillere/${owner.player.username}`, {
        cookie: viewer.cookie,
      });
      check('distriktet er Neon', before.body?.profile?.districtName === 'Neon',
        before.body?.profile?.districtName);

      await prisma.player.update({
        where: { id: owner.player.id },
        data: { currentDistrictId: 'havna' },
      });

      const after = await get(server.base, `/spillere/${owner.player.username}`, {
        cookie: viewer.cookie,
      });
      check('flytting slår gjennom', after.body?.profile?.districtName === 'Havna',
        after.body?.profile?.districtName);

      // A district the catalogue does not know falls back rather than crashing.
      await prisma.player.update({
        where: { id: owner.player.id },
        data: { currentDistrictId: 'finnes-ikke' },
      });
      const broken = await get(server.base, `/spillere/${owner.player.username}`, {
        cookie: viewer.cookie,
      });
      check('ukjent distrikt faller tilbake', broken.status === 200 &&
        broken.body?.profile?.districtName === 'Sentrum', broken.body?.profile?.districtName);
    }

    /* ================================================================== */
    section('7. Spillersøk');

    {
      const viewer = await createTestPlayer();
      const a = await createTestPlayer({ level: 3, reputation: 400, cash: 111111 });
      const b = await createTestPlayer({ level: 1 });

      const res = await get(server.base, `/spillere/sok?sok=${TEST_PREFIX}`, {
        cookie: viewer.cookie,
      });
      check('søket svarer 200', res.status === 200, String(res.status));
      check('det finner testspillerne', res.body?.players?.length >= 3,
        `${res.body?.players?.length}`);
      check('antallet følger med', res.body?.count === res.body?.players?.length);

      const hit = res.body.players.find((p: any) => p.username === a.player.username);
      check('treffet har brukernavn', hit?.username === a.player.username);
      check('treffet har nivå', hit?.level === 3, `${hit?.level}`);
      check('treffet har rykte', hit?.reputation === 400, `${hit?.reputation}`);
      check('treffet har distrikt', hit?.districtId === 'sentrum');
      check('treffet har norsk distriktsnavn', hit?.districtName === 'Sentrum');
      check('treffet har en id', typeof hit?.id === 'string' && hit.id.length > 0);

      const keys = Object.keys(hit).sort();
      check(
        'treffet har nøyaktig de feltene det skal',
        JSON.stringify(keys) ===
          JSON.stringify(['districtId', 'districtName', 'id', 'level', 'reputation', 'username']),
        keys.join(','),
      );

      const blob = JSON.stringify(res.body);
      for (const field of FORBIDDEN_KEYS) {
        check(`søket lekker ikke ${field}`, !blob.includes(field));
      }
      check('og ingen kontantbeholdning', !blob.includes('111111'));
      check('søkeren finner seg selv', res.body.players.some((p: any) => p.id === viewer.player.id));
      check('nivå sorteres først', res.body.players[0].level >= b.player.level);
    }

    {
      const viewer = await createTestPlayer();
      const target = await createTestPlayer();
      const name = target.player.username;

      for (const variant of [name.toUpperCase(), name.toLowerCase()]) {
        const res = await get(
          server.base,
          `/spillere/sok?sok=${encodeURIComponent(variant)}`,
          { cookie: viewer.cookie },
        );
        check(
          `søk med "${variant.slice(0, 8)}..." finner spilleren`,
          res.body?.players?.some((p: any) => p.username === name),
        );
      }

      const short = await get(server.base, '/spillere/sok?sok=a', { cookie: viewer.cookie });
      check('ett tegn avvises', short.status === 400, String(short.status));
      check(
        'meldingen er norsk',
        /minst 2 tegn/.test(short.body?.error?.message ?? ''),
        short.body?.error?.message,
      );

      const empty = await get(server.base, '/spillere/sok?sok=', { cookie: viewer.cookie });
      check('tomt søk avvises', empty.status === 400, String(empty.status));

      const blank = await get(server.base, '/spillere/sok?sok=%20%20%20', {
        cookie: viewer.cookie,
      });
      check('søk med bare mellomrom avvises', blank.status === 400, String(blank.status));

      const missing = await get(server.base, '/spillere/sok', { cookie: viewer.cookie });
      check('manglende søkeord avvises', missing.status === 400, String(missing.status));

      const tooLong = await get(
        server.base,
        `/spillere/sok?sok=${'x'.repeat(PLAYER_SEARCH.maxLength + 1)}`,
        { cookie: viewer.cookie },
      );
      check('for langt søk avvises', tooLong.status === 400, String(tooLong.status));
      check(
        'meldingen er norsk',
        /for langt/.test(tooLong.body?.error?.message ?? ''),
        tooLong.body?.error?.message,
      );

      const absurd = await get(
        server.base,
        `/spillere/sok?sok=${'x'.repeat(5000)}`,
        { cookie: viewer.cookie },
      );
      check('absurd langt søk avvises', absurd.status === 400, String(absurd.status));

      const nothing = await get(server.base, '/spillere/sok?sok=zzzfinnesikkezz', {
        cookie: viewer.cookie,
      });
      check('uten treff svarer det 200', nothing.status === 200, String(nothing.status));
      check('med tom liste', nothing.body?.players?.length === 0);
      check('og antall 0', nothing.body?.count === 0);
    }

    {
      // A search that looks like an attack is a search that finds nothing.
      const viewer = await createTestPlayer();
      const injections = [
        "'; DROP TABLE players; --",
        "' OR '1'='1",
        '%',
        '_',
        '<script>alert(1)</script>',
        '\\',
      ];

      for (const term of injections) {
        const res = await get(
          server.base,
          `/spillere/sok?sok=${encodeURIComponent(term)}`,
          { cookie: viewer.cookie },
        );
        check(
          `søk på ${JSON.stringify(term.slice(0, 16))} håndteres trygt`,
          res.status === 200 || res.status === 400,
          String(res.status),
        );
      }

      check(
        'spillertabellen står fortsatt',
        (await prisma.player.count({ where: { username: { startsWith: TEST_PREFIX } } })) > 0,
      );

      // A wildcard is matched literally, not expanded.
      const wildcard = await get(server.base, '/spillere/sok?sok=%25%25', {
        cookie: viewer.cookie,
      });
      check('prosenttegn er ikke et jokertegn', wildcard.body?.players?.length === 0,
        `${wildcard.body?.players?.length}`);

      const capped = await searchPlayers(TEST_PREFIX);
      check('tjenesten returnerer maks ti', capped.length <= PLAYER_SEARCH.maxResults,
        `${capped.length}`);
    }

    /* ================================================================== */
    section('8. Meldinger fra profilen');

    {
      const from = await createTestPlayer();
      const to = await createTestPlayer();

      const profile = await get(server.base, `/spillere/${to.player.username}`, {
        cookie: from.cookie,
      });
      check('profilen bærer id-en knappen trenger', typeof profile.body?.profile?.id === 'string');
      check('og den peker på riktig spiller', profile.body.profile.id === to.player.id);

      // The existing message system, unchanged: the id from the profile is the
      // same id the send endpoint expects.
      const sent = await post(server.base, '/meldinger/send', {
        cookie: from.cookie,
        body: {
          recipientId: profile.body.profile.id,
          subject: 'Fra profilen',
          content: 'Så deg i gata.',
        },
      });
      check('meldingen sendes', sent.status === 201, String(sent.status));
      check(
        'den havner hos riktig spiller',
        (await prisma.message.count({ where: { recipientId: to.player.id } })) === 1,
      );

      const self = await get(server.base, `/spillere/${from.player.username}`, {
        cookie: from.cookie,
      });
      check('egen profil er markert som ens egen', self.body?.profile?.isSelf === true);
      check('andres profil er det ikke', profile.body?.profile?.isSelf === false);
    }

    /* ================================================================== */
    section('9. Profilen lekker ikke fra andre systemer');

    {
      const owner = await createTestPlayer({ cash: 2000000 });
      const viewer = await createTestPlayer();
      const third = await createTestPlayer();

      await sendMessage(third.player.id, owner.player.id, 'Hemmelig emne', 'Hemmelig innhold');
      await prisma.contactRelationship.create({
        data: { playerId: owner.player.id, contactId: 'marius_mekken', trust: 55 },
      });
      await prisma.information.create({
        data: {
          ownerId: owner.player.id,
          type: 'RYKTE',
          source: 'KONTAKT',
          relevance: 'POLITI',
          title: 'Hemmelig tips',
          content: 'Noe internt',
          reliability: 80,
          isTrue: true,
          baseValue: 100,
        },
      });

      const res = await get(server.base, `/spillere/${owner.player.username}`, {
        cookie: viewer.cookie,
      });
      const blob = JSON.stringify(res.body);

      check('private meldinger lekker ikke', !blob.includes('Hemmelig emne') &&
        !blob.includes('Hemmelig innhold'));
      check('kontaktrelasjoner lekker ikke', !blob.includes('marius_mekken') &&
        !blob.includes('trust'));
      check('informasjon lekker ikke', !blob.includes('Hemmelig tips') && !blob.includes('isTrue'));
      check('øktdata lekker ikke', !blob.includes('token') && !blob.includes('expiresAt'));
      check(
        'ferdigheter lekker ikke',
        !blob.includes('skillId') && !blob.includes('PlayerSkill'),
      );
      check('svaret er lite', blob.length < 500, `${blob.length} tegn`);
    }

    /* ================================================================== */
    section('10. Krever innlogging');

    {
      const owner = await createTestPlayer();

      const profile = await get(server.base, `/spillere/${owner.player.username}`);
      check('profilen krever innlogging', profile.status === 401, String(profile.status));

      const search = await get(server.base, `/spillere/sok?sok=${TEST_PREFIX}`);
      check('søket krever innlogging', search.status === 401, String(search.status));

      check(
        'ingenting lekket til den uinnloggede',
        !JSON.stringify(profile.body ?? {}).includes(owner.player.username),
      );
    }

    /* ================================================================== */
    section('11. Samtidig lesing og endring');

    {
      const owner = await createTestPlayer({ cash: 3000000, currentDistrictId: 'sentrum' });
      const viewer = await createTestPlayer();
      const name = owner.player.username;

      // Profiles are read while the player is buying, selling and being written
      // to. Every answer must be internally consistent and free of leaks.
      const results = await Promise.all([
        ...Array.from({ length: 10 }, () =>
          get(server.base, `/spillere/${name}`, { cookie: viewer.cookie }),
        ),
        buyBusiness(owner.player.id, 'verksted', 'Samtidig'),
        buyAsset(owner.player.id, 'moped'),
        sendMessage(viewer.player.id, owner.player.id, 'Samtidig', 'Melding under lesing.'),
        ...Array.from({ length: 10 }, () =>
          get(server.base, `/spillere/${name}`, { cookie: viewer.cookie }),
        ),
      ]);

      const reads = results.filter(
        (r): r is { status: number; body: any } =>
          typeof r === 'object' && r !== null && 'status' in r,
      );

      check('alle profil-lesninger svarer 200', reads.every((r) => r.status === 200),
        reads.map((r) => r.status).join(','));
      check(
        'ingen av dem lekker noe privat',
        reads.every((r) => {
          const blob = JSON.stringify(r.body);
          return FORBIDDEN_KEYS.every((field) => !blob.includes(field));
        }),
      );
      check(
        'tellingene er alltid gyldige tall',
        reads.every(
          (r) =>
            Number.isInteger(r.body.profile.businessCount) &&
            r.body.profile.businessCount >= 0 &&
            Number.isInteger(r.body.profile.assetCount) &&
            r.body.profile.assetCount >= 0,
        ),
      );
      check(
        'tellingene overstiger aldri det som faktisk finnes',
        reads.every(
          (r) => r.body.profile.businessCount <= 1 && r.body.profile.assetCount <= 1,
        ),
      );

      const final = await get(server.base, `/spillere/${name}`, { cookie: viewer.cookie });
      check('sluttilstanden stemmer', final.body?.profile?.businessCount === 1 &&
        final.body?.profile?.assetCount === 1,
        `${final.body?.profile?.businessCount}/${final.body?.profile?.assetCount}`);

      const after = await reload(owner.player.id);
      check('spilleren er uskadd', after.cash >= 0 && after.level >= 1);
    }

    {
      // The same profile, opened by many players at once.
      const owner = await createTestPlayer({ cash: 5000 });
      const viewers = await Promise.all(
        Array.from({ length: 8 }, () => createTestPlayer()),
      );

      const results = await burst(24, (i) =>
        get(server.base, `/spillere/${owner.player.username}`, {
          cookie: viewers[i % viewers.length]!.cookie,
        }),
      );

      note(`${results.length} samtidige oppslag`);
      check('alle svarer 200', results.every((r) => r.status === 200));
      check(
        'alle får samme profil',
        new Set(results.map((r) => JSON.stringify(r.body.profile))).size === 1,
      );
      check(
        'ingen av dem er markert som ens egen',
        results.every((r) => r.body.profile.isSelf === false),
      );
    }

    {
      // Many searches at once, while players are being written.
      const viewer = await createTestPlayer();
      const target = await createTestPlayer({ cash: 400000 });

      const results = await Promise.all([
        ...Array.from({ length: 20 }, () =>
          get(server.base, `/spillere/sok?sok=${TEST_PREFIX}`, { cookie: viewer.cookie }),
        ),
        buyAsset(target.player.id, 'moped'),
      ]);

      const searches = results.filter(
        (r): r is { status: number; body: any } =>
          typeof r === 'object' && r !== null && 'status' in r,
      );

      check('alle søk svarer 200', searches.every((r) => r.status === 200),
        searches.map((r) => r.status).join(','));
      check(
        'ingen søk returnerer mer enn ti',
        searches.every((r) => r.body.players.length <= PLAYER_SEARCH.maxResults),
      );
      check(
        'ingen søk lekker noe privat',
        searches.every((r) => {
          const blob = JSON.stringify(r.body);
          return FORBIDDEN_KEYS.every((field) => !blob.includes(field));
        }),
      );
    }

    /* ================================================================== */
    section('12. Rate limiting per spiller');

    {
      const viewer = await createTestPlayer();
      const target = await createTestPlayer();

      const results: Array<{ status: number; body: any }> = [];
      for (let i = 0; i < 65; i += 1) {
        results.push(
          await get(server.base, `/spillere/sok?sok=${TEST_PREFIX}`, {
            cookie: viewer.cookie,
          }),
        );
      }

      const ok = results.filter((r) => r.status === 200).length;
      const limited = results.filter((r) => r.status === 429);

      note(`søk ok=${ok} blokkert=${limited.length}`);
      check('søk slipper gjennom 60', ok === 60, `${ok}`);
      check('resten blokkeres', limited.length === 5, `${limited.length}`);
      check(
        'meldingen er på norsk',
        limited[0]?.body?.error?.message === 'Du søker for raskt. Vent litt.',
        limited[0]?.body?.error?.message,
      );

      // Separate quotas: a spent search budget does not block profiles.
      const profile = await get(server.base, `/spillere/${target.player.username}`, {
        cookie: viewer.cookie,
      });
      check('profilen har egen kvote', profile.status === 200, String(profile.status));

      const other = await createTestPlayer();
      const free = await get(server.base, `/spillere/sok?sok=${TEST_PREFIX}`, {
        cookie: other.cookie,
      });
      check('en annen spiller har egen kvote', free.status === 200, String(free.status));
    }

    {
      const viewer = await createTestPlayer();
      const target = await createTestPlayer();

      const results: Array<{ status: number }> = [];
      for (let i = 0; i < 125; i += 1) {
        results.push(
          await get(server.base, `/spillere/${target.player.username}`, {
            cookie: viewer.cookie,
          }),
        );
      }

      const ok = results.filter((r) => r.status === 200).length;
      const limited = results.filter((r) => r.status === 429).length;

      note(`profiler ok=${ok} blokkert=${limited}`);
      check('profilen slipper gjennom 120', ok === 120, `${ok}`);
      check('resten blokkeres', limited === 5, `${limited}`);
    }

    /* ================================================================== */
    section('13. Ingen andre systemer er rørt');

    {
      const owner = await createTestPlayer({ cash: 7500, energy: 100, heat: 5 });
      const viewer = await createTestPlayer();
      const before = await reload(owner.player.id);

      await get(server.base, `/spillere/${owner.player.username}`, { cookie: viewer.cookie });
      await get(server.base, `/spillere/sok?sok=${TEST_PREFIX}`, { cookie: viewer.cookie });

      const after = await reload(owner.player.id);
      check('kontantene er urørt', after.cash === before.cash, `${after.cash}`);
      check('energien er urørt', after.energy === before.energy, `${after.energy}`);
      check('heat er urørt', after.heat === before.heat);
      check('helsa er urørt', after.health === before.health);
      check('XP er urørt', after.xp === before.xp);
      check('nivået er urørt', after.level === before.level);
      check('distriktet er urørt', after.currentDistrictId === before.currentDistrictId);
      check(
        'å bli sett på koster ingenting',
        (await prisma.transaction.count({ where: { playerId: owner.player.id } })) === 0,
      );
      check(
        'og skriver ingen meldinger',
        (await prisma.message.count({ where: { recipientId: owner.player.id } })) === 0,
      );

      const viewerAfter = await reload(viewer.player.id);
      check('den som ser er også urørt', viewerAfter.energy === 100 && viewerAfter.xp === 0);
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
