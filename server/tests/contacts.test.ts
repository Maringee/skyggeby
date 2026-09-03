/**
 * Integration tests for contacts, against the real PostgreSQL database and a
 * real Express server.
 *
 * Run with `npm -w @skyggeby/server run test:contacts`.
 */
import {
  CONTACTS,
  CONTACT_ACTIVITY,
  CONTACT_IDS,
  CONTACT_TYPES,
  DISTRICT_IDS,
  TRUST_TUNING,
  contactsInDistrict,
  findContact,
  trustLabel,
  validateContactCatalogue,
} from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/errors';
import {
  discoverContact,
  interactWithContact,
} from '../src/modules/contacts/contact.service';
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

async function relationsOf(playerId: string) {
  return prisma.contactRelationship.findMany({ where: { playerId } });
}

/** Gives a player a known contact directly, bypassing discovery. */
async function giveContact(playerId: string, contactId: string, trust = 10) {
  return prisma.contactRelationship.create({
    data: { playerId, contactId, trust, status: 'AVAILABLE' },
  });
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1-4. Katalogen');

    {
      const problems = validateContactCatalogue();
      check('katalogen er gyldig', problems.length === 0, problems.join('; '));
      check('minst 12 personer', CONTACTS.length >= 12, `${CONTACTS.length}`);
      note(`${CONTACTS.length} personer, ${CONTACT_TYPES.length} typer`);

      const ids = CONTACTS.map((c) => c.id);
      check('alle id-er er unike', new Set(ids).size === ids.length);
      const names = CONTACTS.map((c) => c.name);
      check('alle navn er unike', new Set(names).size === names.length);

      check('seks kontakttyper', CONTACT_TYPES.length === 6);
      check(
        'alle typer er i bruk',
        CONTACT_TYPES.every((t) => CONTACTS.some((c) => c.type === t)),
        CONTACT_TYPES.filter((t) => !CONTACTS.some((c) => c.type === t)).join(','),
      );
      check(
        'alle distrikter finnes',
        CONTACTS.every((c) => (DISTRICT_IDS as readonly string[]).includes(c.districtId)),
      );
      check(
        'alle distrikter har minst én person',
        DISTRICT_IDS.every((d) => contactsInDistrict(d).length > 0),
        DISTRICT_IDS.filter((d) => contactsInDistrict(d).length === 0).join(','),
      );
      check(
        'pålitelighet er 0-100',
        CONTACTS.every((c) => c.reliability >= 0 && c.reliability <= 100),
      );
      check('id-ene er stabile slugs',
        CONTACTS.every((c) => /^[a-z_]+$/.test(c.id)),
        CONTACTS.filter((c) => !/^[a-z_]+$/.test(c.id)).map((c) => c.id).join(','));
    }

    /* ================================================================== */
    section('5-10. Oppdagelse');

    {
      const t = await createTestPlayer();
      await prisma.player.update({
        where: { id: t.player.id },
        data: { currentDistrictId: 'havna' },
      });

      const res = await post(server.base, '/kontakter/oppdag', { cookie: t.cookie });

      check('oppdagelse svarer 200', res.status === 200, String(res.status));
      check('en kontakt ble funnet', res.body?.found === true);
      check('meldingen er norsk', /Du ble kjent med/.test(res.body?.message ?? ''),
        res.body?.message);

      const rows = await relationsOf(t.player.id);
      check('relasjonen ble opprettet', rows.length === 1, `${rows.length}`);
      check('tilliten starter på 10', rows[0]!.trust === TRUST_TUNING.start,
        `${rows[0]!.trust}`);
      check('statusen er AVAILABLE', rows[0]!.status === 'AVAILABLE');
      check('eieren er riktig', rows[0]!.playerId === t.player.id);
      check('ingen interaksjon ennå', rows[0]!.lastInteractionAt === null);

      const definition = findContact(rows[0]!.contactId);
      check('personen kommer fra katalogen', definition !== undefined);
      check('personen hører hjemme i Havna', definition?.districtId === 'havna',
        definition?.districtId);
      check('svaret oppgir distriktet', res.body?.contact?.districtName === 'Havna');
      check('svaret oppgir rollen', typeof res.body?.contact?.role === 'string');

      // Discovery costs energy and pays experience: the network is an early
      // route forward, and it competes for the same budget crime does.
      const after = await reload(t.player.id);
      check('koster ikke penger', after.cash === t.player.cash, `${after.cash}`);
      check(
        'koster energi',
        after.energy === t.player.energy - CONTACT_ACTIVITY.discoverEnergyCost,
        `${after.energy}`,
      );
      check(
        'gir erfaring',
        after.xp === t.player.xp + CONTACT_ACTIVITY.discoverXp,
        `${after.xp}`,
      );
      check('svaret oppgir kostnaden', res.body?.energySpent === CONTACT_ACTIVITY.discoverEnergyCost,
        `${res.body?.energySpent}`);
      check('svaret oppgir erfaringen', res.body?.xpGained === CONTACT_ACTIVITY.discoverXp,
        `${res.body?.xpGained}`);

      // Keep going until Havna is exhausted, then it widens.
      const havnaCount = contactsInDistrict('havna').length;
      for (let i = 1; i < havnaCount; i += 1) {
        await post(server.base, '/kontakter/oppdag', { cookie: t.cookie });
      }
      const afterLocal = await relationsOf(t.player.id);
      const allLocal = afterLocal.every(
        (r) => findContact(r.contactId)?.districtId === 'havna',
      );
      check('distriktet prioriteres til det er tomt', allLocal && afterLocal.length === havnaCount,
        `${afterLocal.length}/${havnaCount}`);

      const widened = await post(server.base, '/kontakter/oppdag', { cookie: t.cookie });
      check('søket utvides når distriktet er tomt', widened.body?.found === true);
      check('meldingen forteller at det er et tips',
        /Du ble tipset om/.test(widened.body?.message ?? ''), widened.body?.message);

      // A client-supplied district is ignored.
      const other = await createTestPlayer();
      await prisma.player.update({
        where: { id: other.player.id },
        data: { currentDistrictId: 'regjeringskvartalet' },
      });
      const forged = await post(server.base, '/kontakter/oppdag', {
        cookie: other.cookie,
        body: { districtId: 'neon', currentDistrictId: 'neon', contactId: 'kraka' },
      });
      const forgedRows = await relationsOf(other.player.id);
      check('klientens distrikt ignoreres',
        findContact(forgedRows[0]!.contactId)?.districtId === 'regjeringskvartalet',
        findContact(forgedRows[0]!.contactId)?.districtId);
      check('klientens contactId ignoreres', forgedRows[0]!.contactId !== 'kraka');
      check('spilleren ble ikke flyttet',
        (await reload(other.player.id)).currentDistrictId === 'regjeringskvartalet');
      void forged;
    }

    {
      // Everyone can be met exactly once, and then it stops cleanly.
      const t = await createTestPlayer();
      for (let i = 0; i < CONTACTS.length; i += 1) {
        await discoverContact(t.player.id);
      }
      const rows = await relationsOf(t.player.id);
      check('kan bli kjent med alle', rows.length === CONTACTS.length, `${rows.length}`);
      check('ingen duplikater', new Set(rows.map((r) => r.contactId)).size === rows.length);

      const exhausted = await post(server.base, '/kontakter/oppdag', { cookie: t.cookie });
      check('tomt utvalg gir en tydelig melding',
        exhausted.body?.found === false &&
          exhausted.body?.message === 'Du fant ingen nye kontakter denne gangen.',
        exhausted.body?.message);
      check('ingen ny rad ble laget',
        (await relationsOf(t.player.id)).length === CONTACTS.length);
    }

    /* ================================================================== */
    section('11-14. Kontakt og tillit');

    {
      const t = await createTestPlayer();
      const rel = await giveContact(t.player.id, 'marius_mekken', 42);

      const res = await post(server.base, '/kontakter/kontakt', {
        cookie: t.cookie,
        body: { contactId: 'marius_mekken' },
      });

      check('kontakt svarer 200', res.status === 200, String(res.status));
      check('tilliten økte med 1', res.body?.contact?.trust === 43,
        String(res.body?.contact?.trust));
      check('svaret oppgir økningen', res.body?.trustGained === 1);

      // Talking is cheap, but not free: it competes with crime for the same
      // energy, which is what makes "who do I spend the evening on" a question.
      const spent = await reload(t.player.id);
      check(
        'praten kostet energi',
        spent.energy === t.player.energy - CONTACT_ACTIVITY.interactEnergyCost,
        `${spent.energy}`,
      );
      check(
        'praten ga erfaring',
        spent.xp === t.player.xp + CONTACT_ACTIVITY.interactXp,
        `${spent.xp}`,
      );
      check('svaret oppgir kostnaden',
        res.body?.energySpent === CONTACT_ACTIVITY.interactEnergyCost,
        `${res.body?.energySpent}`);
      check('meldingen er norsk', /Du tok en prat med Marius/.test(res.body?.message ?? ''),
        res.body?.message);
      check('etiketten er riktig', res.body?.contact?.trustLabel === 'Kontakt',
        res.body?.contact?.trustLabel);

      const after = await prisma.contactRelationship.findUniqueOrThrow({
        where: { id: rel.id },
      });
      check('tidspunktet ble satt', after.lastInteractionAt !== null);

      // Trust labels across the bands.
      const bands: Array<[number, string]> = [
        [0, 'Ukjent'],
        [19, 'Ukjent'],
        [20, 'Bekjent'],
        [39, 'Bekjent'],
        [40, 'Kontakt'],
        [59, 'Kontakt'],
        [60, 'Betrodd'],
        [79, 'Betrodd'],
        [80, 'Nær kontakt'],
        [100, 'Nær kontakt'],
      ];
      const wrong = bands.filter(([value, label]) => trustLabel(value) !== label);
      check('alle tillitsnivåer stemmer', wrong.length === 0,
        wrong.map(([v]) => v).join(','));

      // Ceiling.
      const capped = await createTestPlayer();
      await giveContact(capped.player.id, 'sara_viken', 100);
      const atMax = await post(server.base, '/kontakter/kontakt', {
        cookie: capped.cookie,
        body: { contactId: 'sara_viken' },
      });
      check('tilliten stopper på 100', atMax.body?.contact?.trust === 100,
        String(atMax.body?.contact?.trust));
      check('ingen økning ved taket', atMax.body?.trustGained === 0);
      check('meldingen forklarer det',
        /så nær som dere kan/.test(atMax.body?.message ?? ''), atMax.body?.message);

      // Unknown contact.
      const stranger = await createTestPlayer();
      const unknown = await post(server.base, '/kontakter/kontakt', {
        cookie: stranger.cookie,
        body: { contactId: 'marius_mekken' },
      });
      check('ukjent kontakt kan ikke kontaktes', unknown.status === 404,
        String(unknown.status));
      check('meldingen er nøytral',
        unknown.body?.error?.message === 'Du kjenner ikke denne personen.',
        unknown.body?.error?.message);

      const bad = await Promise.all([
        post(server.base, '/kontakter/kontakt', { cookie: t.cookie, body: {} }),
        post(server.base, '/kontakter/kontakt', {
          cookie: t.cookie,
          body: { contactId: 'finnes_ikke' },
        }),
        post(server.base, '/kontakter/kontakt', { cookie: t.cookie, body: { contactId: 7 } }),
      ]);
      check('ugyldig input avvises', bad.every((r) => r.status === 400),
        bad.map((r) => r.status).join(','));
    }

    /* ================================================================== */
    section('15-19. Eierskap, status og lekkasje');

    {
      const victim = await createTestPlayer();
      const victimRel = await giveContact(victim.player.id, 'tommy_ravn', 55);
      const attacker = await createTestPlayer();

      const attempt = await post(server.base, '/kontakter/kontakt', {
        cookie: attacker.cookie,
        body: { contactId: 'tommy_ravn' },
      });
      check('kan ikke kontakte andres kontakt', attempt.status === 404,
        String(attempt.status));

      const untouched = await prisma.contactRelationship.findUniqueOrThrow({
        where: { id: victimRel.id },
      });
      check('offerets tillit er uendret', untouched.trust === 55, `${untouched.trust}`);
      check('offerets tidspunkt er uendret', untouched.lastInteractionAt === null);
      check('angriperen fikk ingen relasjon',
        (await relationsOf(attacker.player.id)).length === 0);

      const detail = await get(server.base, '/kontakter/tommy_ravn', {
        cookie: attacker.cookie,
      });
      check('detaljer om ukjent gir 404', detail.status === 404, String(detail.status));
      check('meldingen er nøytral',
        detail.body?.error?.message === 'Du kjenner ikke denne personen.',
        detail.body?.error?.message);

      const own = await get(server.base, '/kontakter/tommy_ravn', { cookie: victim.cookie });
      check('eieren får detaljene', own.status === 200, String(own.status));
      check('detaljene har navn og rolle',
        own.body?.contact?.name === 'Tommy Ravn' && own.body?.contact?.role === 'Informant');

      const list = await get(server.base, '/kontakter', { cookie: victim.cookie });
      check('GET returnerer kun egne kontakter',
        list.body.contacts.length === 1 && list.body.contacts[0].id === 'tommy_ravn');
      check('antallet stemmer', list.body.count === 1);
      check('totalen oppgis', list.body.totalKnown === CONTACTS.length);

      // Reliability never leaves the server.
      const raw = JSON.stringify([list.body, own.body, detail.body]);
      check('pålitelighet lekker ikke', !/reliability|paalitelighet|pålitelighet/i.test(raw),
        raw.slice(0, 120));
      check('interne felter lekker ikke',
        !/playerId|passwordHash|createdAt|updatedAt/.test(JSON.stringify(list.body)));

      // Status is enforced.
      const busyOwner = await createTestPlayer();
      const busy = await giveContact(busyOwner.player.id, 'kraka', 30);
      await prisma.contactRelationship.update({
        where: { id: busy.id },
        data: { status: 'BUSY' },
      });
      const busyRes = await post(server.base, '/kontakter/kontakt', {
        cookie: busyOwner.cookie,
        body: { contactId: 'kraka' },
      });
      check('opptatt kontakt avvises', busyRes.status === 400, String(busyRes.status));
      check('meldingen er norsk',
        busyRes.body?.error?.message === 'Personen er opptatt akkurat nå.',
        busyRes.body?.error?.message);
      check('tilliten er uendret',
        (await prisma.contactRelationship.findUniqueOrThrow({ where: { id: busy.id } }))
          .trust === 30);
      check('lista merker den som utilgjengelig',
        (await get(server.base, '/kontakter', { cookie: busyOwner.cookie })).body
          .contacts[0].canContact === false);
    }

    /* ================================================================== */
    section('21-22. Samtidighet: oppdagelse');

    {
      // Only one person left in the whole city.
      const t = await createTestPlayer();
      const all = CONTACT_IDS.slice(0, CONTACTS.length - 1);
      for (const id of all) await giveContact(t.player.id, id);

      const results = await burst(20, () => settle(() => discoverContact(t.player.id)));
      const found = results.filter((r) => r.ok && r.value?.relationship !== null);
      const empty = results.filter((r) => r.ok && r.value?.relationship === null);

      note(`én ledig: fant=${found.length} tomt=${empty.length}`);
      check('nøyaktig én ny relasjon', found.length === 1, `${found.length}`);
      check('resten fant ingenting', empty.length === 19, `${empty.length}`);

      const rows = await relationsOf(t.player.id);
      check('alle kontakter er kjent nøyaktig én gang',
        rows.length === CONTACTS.length &&
          new Set(rows.map((r) => r.contactId)).size === rows.length,
        `${rows.length}`);
    }

    {
      // Many free contacts, twenty requests at once.
      const t = await createTestPlayer();
      const results = await burst(20, () => settle(() => discoverContact(t.player.id)));
      const found = results.filter((r) => r.ok && r.value?.relationship !== null).length;

      const rows = await relationsOf(t.player.id);
      const unique = new Set(rows.map((r) => r.contactId));

      note(`mange ledige: fant=${found} rader=${rows.length}`);
      check('hver oppdagelse gir én rad', rows.length === found, `${rows.length} vs ${found}`);
      check('ingen duplikater', unique.size === rows.length, `${unique.size}`);
      check('ingen uventede feil', results.every((r) => r.ok),
        results.filter((r) => !r.ok).map((r) => r.code).join(','));

      // The unique constraint holds even against a direct duplicate insert.
      const dup = await settle(() => giveContact(t.player.id, rows[0]!.contactId));
      check('databasen avviser duplikat', !dup.ok, 'ble godtatt');
    }

    /* ================================================================== */
    section('23. Samtidighet: tillit');

    {
      const t = await createTestPlayer();
      await giveContact(t.player.id, 'nina_solberg', 99);

      const results = await burst(20, () =>
        settle(() => interactWithContact(t.player.id, 'nina_solberg')),
      );

      const row = await prisma.contactRelationship.findFirstOrThrow({
        where: { playerId: t.player.id, contactId: 'nina_solberg' },
      });

      note(`fra 99, 20 samtidige -> ${row.trust}`);
      check('alle kall lyktes', results.every((r) => r.ok),
        results.filter((r) => !r.ok).map((r) => r.code).join(','));
      check('tilliten er nøyaktig 100', row.trust === 100, `${row.trust}`);
      check('aldri over 100', row.trust <= 100);

      // Twenty from a low value: no lost updates.
      const t2 = await createTestPlayer();
      await giveContact(t2.player.id, 'viktor_dahl', 10);
      await burst(20, () => settle(() => interactWithContact(t2.player.id, 'viktor_dahl')));
      const row2 = await prisma.contactRelationship.findFirstOrThrow({
        where: { playerId: t2.player.id, contactId: 'viktor_dahl' },
      });
      note(`fra 10, 20 samtidige -> ${row2.trust}`);
      check('alle 20 økningene ble registrert', row2.trust === 30, `${row2.trust}`);
    }

    /* ================================================================== */
    section('24-25. Rollback og manipulasjon');

    {
      // A real constraint makes the write fail after the checks have passed.
      const t = await createTestPlayer();
      await giveContact(t.player.id, 'presten', 50);

      await prisma.$executeRawUnsafe(
        `ALTER TABLE contact_relationships ADD CONSTRAINT qa_block_trust
         CHECK ("trust" < 51) NOT VALID`,
      );

      let failed = false;
      try {
        const result = await settle(() => interactWithContact(t.player.id, 'presten'));
        failed = !result.ok;
      } finally {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE contact_relationships DROP CONSTRAINT qa_block_trust',
        );
      }

      check('skrivingen feilet som forventet', failed);
      const row = await prisma.contactRelationship.findFirstOrThrow({
        where: { playerId: t.player.id, contactId: 'presten' },
      });
      check('tilliten er rullet tilbake', row.trust === 50, `${row.trust}`);
      check('tidspunktet ble ikke satt', row.lastInteractionAt === null);

      const recovered = await settle(() => interactWithContact(t.player.id, 'presten'));
      check('fungerer igjen etterpå', recovered.ok, recovered.code);

      // Manipulated fields.
      const victim = await createTestPlayer();
      const manip = await createTestPlayer();
      await giveContact(manip.player.id, 'hanne_ruud', 20);

      const res = await post(server.base, '/kontakter/kontakt', {
        cookie: manip.cookie,
        body: {
          contactId: 'hanne_ruud',
          trust: 100,
          reliability: 100,
          districtId: 'regjeringskvartalet',
          playerId: victim.player.id,
          status: 'AVAILABLE',
          trustGained: 99,
          lastInteractionAt: null,
        },
      });

      check('forespørselen behandles normalt', res.status === 200, String(res.status));
      check('tilliten økte med nøyaktig 1', res.body?.contact?.trust === 21,
        String(res.body?.contact?.trust));
      check('den forfalskede økningen ble ignorert', res.body?.trustGained === 1);
      check('offeret fikk ingen relasjon',
        (await relationsOf(victim.player.id)).length === 0);
      check('distriktet er personens eget',
        res.body?.contact?.districtId === findContact('hanne_ruud')?.districtId,
        res.body?.contact?.districtId);
    }

    /* ================================================================== */
    section('20. Tilgang');

    {
      const anonList = await get(server.base, '/kontakter');
      const anonDiscover = await post(server.base, '/kontakter/oppdag');
      const anonContact = await post(server.base, '/kontakter/kontakt', {
        body: { contactId: 'kraka' },
      });
      const anonDetail = await get(server.base, '/kontakter/kraka');

      check('liste uten sesjon gir 401', anonList.status === 401, String(anonList.status));
      check('oppdagelse uten sesjon gir 401', anonDiscover.status === 401,
        String(anonDiscover.status));
      check('kontakt uten sesjon gir 401', anonContact.status === 401,
        String(anonContact.status));
      check('detaljer uten sesjon gir 401', anonDetail.status === 401,
        String(anonDetail.status));

      const t = await createTestPlayer();
      const empty = await get(server.base, '/kontakter', { cookie: t.cookie });
      check('tom liste er gyldig', Array.isArray(empty.body?.contacts));
      check('antallet starter på 0', empty.body?.count === 0);
    }
  } finally {
    await server.close();
    await prisma
      .$executeRawUnsafe(
        'ALTER TABLE contact_relationships DROP CONSTRAINT IF EXISTS qa_block_trust',
      )
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
    .$executeRawUnsafe(
      'ALTER TABLE contact_relationships DROP CONSTRAINT IF EXISTS qa_block_trust',
    )
    .catch(() => undefined);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
