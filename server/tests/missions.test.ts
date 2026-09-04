/**
 * Mission System v1 - integration tests against the real PostgreSQL database.
 *
 * Nothing is mocked. The concurrency sections in particular exist to prove that
 * the row locks and the conditional claims behave under genuine parallel load,
 * which no mock could ever demonstrate.
 *
 * Run with `npm -w @skyggeby/server run test:missions`.
 */
import {
  MISSIONS,
  MISSION_TUNING,
  eventObjectiveOf,
  findMission,
  findSkill,
  isEventObjective,
  objectiveTarget,
  validateMissionCatalogue,
  xpRequiredForLevel,
} from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import {
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
  TEST_PREFIX,
  section,
  startServer,
  summary,
  type TestPlayer,
} from './harness';

/** Introduces a player to a contact at a given trust, the way discovery would. */
async function know(playerId: string, contactId: string, trust = 50) {
  await prisma.contactRelationship.upsert({
    where: { playerId_contactId: { playerId, contactId } },
    create: { playerId, contactId, trust, status: 'AVAILABLE' },
    update: { trust },
  });
}

/** Clears every crime cooldown so a test can act again without waiting. */
async function clearCrimeCooldowns(playerId: string) {
  await prisma.crimeAttempt.updateMany({
    where: { playerId },
    data: { cooldownUntil: new Date(0) },
  });
}

/** The mission row as the database holds it. */
async function missionRow(playerId: string, missionId: string) {
  return prisma.mission.findFirst({
    where: { playerId, missionId },
    orderBy: { createdAt: 'desc' },
  });
}

function findDto(body: any, missionId: string) {
  return (body?.missions ?? []).find((m: any) => m.id === missionId);
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1. Katalogen henger sammen');

    {
      const problems = validateMissionCatalogue();
      check('katalogen validerer uten problemer', problems.length === 0, problems.join(' | '));
      check('det finnes 18 oppdrag', MISSIONS.length === 18, `${MISSIONS.length}`);

      const ids = new Set(MISSIONS.map((m) => m.id));
      check('alle id-er er unike', ids.size === MISSIONS.length);

      // The one-counter rule is what keeps the persistence cost at a single
      // integer. A second counted action would silently share the counter.
      const tooMany = MISSIONS.filter(
        (m) => m.objectives.filter(isEventObjective).length > 1,
      );
      check('ingen oppdrag har mer enn ett handlingsmål', tooMany.length === 0,
        tooMany.map((m) => m.id).join(','));

      const tooLong = MISSIONS.filter((m) => m.objectives.length > MISSION_TUNING.maxObjectives);
      check('ingen oppdrag har mer enn tre mål', tooLong.length === 0);
      check('alle oppdrag har minst ett mål', MISSIONS.every((m) => m.objectives.length > 0));

      // Missions must accelerate the game, not replace it. Above roughly half,
      // ordinary crime stops being the thing you do.
      const band = (lo: number, hi: number) =>
        MISSIONS.filter((m) => m.minLevel >= lo && m.minLevel <= hi)
          .reduce((sum, m) => sum + m.rewards.xp, 0);

      const bands: Array<[string, number, number]> = [
        ['1-3', band(1, 3), xpRequiredForLevel(4) - xpRequiredForLevel(1)],
        ['4-6', band(4, 6), xpRequiredForLevel(7) - xpRequiredForLevel(4)],
        ['7-10', band(7, 10), xpRequiredForLevel(10) - xpRequiredForLevel(7)],
      ];

      for (const [label, xp, required] of bands) {
        const share = xp / required;
        note(`nivå ${label}: ${xp} XP av ${required} = ${Math.round(share * 100)} %`);
        check(
          `oppdrag er en drivkraft, ikke hovedkilden, på nivå ${label}`,
          share >= 0.25 && share <= 0.45,
          `${Math.round(share * 100)} %`,
        );
      }

      // Missions exist to give the rest of the game a reason, so most of them
      // must actually ask the player to go and do something.
      const withAction = MISSIONS.filter((m) => eventObjectiveOf(m)).length;
      note(`${withAction} av ${MISSIONS.length} oppdrag krever en faktisk handling`);
      check('flertallet av oppdragene bruker eksisterende gameplay', withAction >= 12);

      const kinds = new Set(MISSIONS.flatMap((m) => m.objectives.map((o) => o.kind)));
      note(`måltyper i bruk: ${[...kinds].sort().join(', ')}`);
      check('oppdragene varierer i hva de ber om', kinds.size >= 10, `${kinds.size}`);

      const levels = new Set(MISSIONS.map((m) => m.minLevel));
      check('oppdragene er spredt over nivåene', levels.size >= 7, `${levels.size}`);

      // Businesses and properties were promoted to must-have, so something has
      // to actually use them.
      const usesBusiness = MISSIONS.some((m) =>
        m.objectives.some((o) => o.kind === 'EIE_VIRKSOMHET'),
      );
      const usesProperty = MISSIONS.some((m) =>
        m.objectives.some((o) => o.kind === 'EIE_EIENDOM'),
      );
      check('virksomhet er i bruk som mål', usesBusiness);
      check('eiendom er i bruk som mål', usesProperty);
    }

    /* ================================================================== */
    section('2. Hva spilleren får se');

    {
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });

      const empty = await get(server.base, '/oppdrag', { cookie: t.cookie });
      check('en ny spiller kan hente oppdragslisten', empty.status === 200, `${empty.status}`);
      check(
        'men ser ingen oppdrag før de kjenner noen',
        empty.body.missions.length === 0,
        `${empty.body.missions.length}`,
      );
      check('og har ingen aktive', empty.body.activeCount === 0);
      check('taket er tre', empty.body.maxActive === MISSION_TUNING.maxActive);

      await know(t.player.id, 'kraka', 30);
      const known = await get(server.base, '/oppdrag', { cookie: t.cookie });

      const first = findDto(known.body, 'kraka_forste_tips');
      check('etter å ha møtt Kråka dukker hennes oppdrag opp', Boolean(first));
      check('det er tilgjengelig', first?.availability === 'TILGJENGELIG', first?.availability);
      check('det viser hvem som gir det', first?.contactName === '«Kråka»', first?.contactName);
      check('det viser distriktet', first?.districtName === 'Blokkene', first?.districtName);
      check('det har norsk innledning', typeof first?.briefing === 'string' && first.briefing.length > 20);
      check(
        'sluttreplikken er ikke røpet på forhånd',
        first?.debriefing === null,
        String(first?.debriefing),
      );
      check('målet er beskrevet på norsk', first?.objectives?.[0]?.label?.includes('lommetyveri'), first?.objectives?.[0]?.label);
      check('framdriften starter på null', first?.objectives?.[0]?.current === 0);
      check('målet er to', first?.objectives?.[0]?.target === 2);

      // Later links of a chain stay out of sight so the chain has something to
      // reveal - but the player is told there is more.
      check(
        'neste ledd i kjeden er ikke synlig ennå',
        findDto(known.body, 'kraka_butikken') === undefined,
      );
      check('men spilleren får vite at kjeden fortsetter', known.body.chainContinues >= 1,
        `${known.body.chainContinues}`);

      // Somebody they have never met offers them nothing at all.
      check(
        'oppdrag fra ukjente personer er usynlige',
        findDto(known.body, 'jonas_siste_ordet') === undefined,
      );

      // A mission they can see but not take is shown with the reason, because
      // a locked mission is a goal and a hidden one is nothing.
      await know(t.player.id, 'lise_moen', 20);
      const locked = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const lise = findDto(locked.body, 'lise_natten');
      check('et for vanskelig oppdrag vises som låst', lise?.availability === 'LAAST', lise?.availability);
      check(
        'og sier hva som mangler, med spillerens egne tall',
        typeof lise?.blockedReason === 'string' && lise.blockedReason.includes('nivå 8') &&
          lise.blockedReason.includes('nivå 3'),
        lise?.blockedReason,
      );
      check(
        'hvert enkeltkrav er merket av eller ikke',
        Array.isArray(lise?.conditions) && lise.conditions.some((c: any) => c.met === false),
      );
      check(
        'betalingen holdes tilbake til tilliten er høy nok',
        lise?.rewardsHidden === true && lise?.rewards?.cash === 0,
        `${lise?.rewardsHidden}/${lise?.rewards?.cash}`,
      );
    }

    /* ================================================================== */
    section('3. Å ta et oppdrag');

    {
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      await know(t.player.id, 'kraka', 30);

      const accepted = await post(server.base, '/oppdrag/kraka_forste_tips/godta', {
        cookie: t.cookie,
      });
      check('oppdraget kan tas', accepted.status === 201, `${accepted.status}`);
      check('svaret sier hva som skjedde, på norsk', typeof accepted.body?.message === 'string' &&
        accepted.body.message.includes('Kråka'), accepted.body?.message);
      check('det telles som aktivt', accepted.body.activeCount === 1);

      const row = await missionRow(t.player.id, 'kraka_forste_tips');
      check('det ble skrevet én rad', row !== null);
      check('raden er aktiv', row?.status === 'AKTIV', row?.status);
      check('framdriften er null', row?.progressCount === 0);
      check('oppdragsgiveren er lagret på raden', row?.contactId === 'kraka', row?.contactId);
      check('uten frist, siden dette oppdraget ikke har en', row?.expiresAt === null);

      const again = await post(server.base, '/oppdrag/kraka_forste_tips/godta', {
        cookie: t.cookie,
      });
      check('det kan ikke tas to ganger', again.status === 409, `${again.status}`);
      check('og feilen er norsk', typeof again.body?.error?.message === 'string' &&
        /allerede/i.test(again.body.error.message), again.body?.error?.message);

      // Taking a mission costs nothing. The price is the work.
      const after = await reload(t.player.id);
      check('å ta et oppdrag koster ingen energi', after.energy === t.player.energy,
        `${after.energy} vs ${t.player.energy}`);
      check('og ingen penger', after.cash === t.player.cash);
    }

    {
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum', cash: 50000 });
      for (const id of ['kraka', 'gunnar_toft', 'mette_dal', 'sara_viken', 'nina_solberg']) {
        await know(t.player.id, id, 40);
      }

      const takeable = ['kraka_forste_tips', 'gunnar_lykta', 'mette_ryktet', 'nina_visningen'];
      const results: number[] = [];
      for (const id of takeable) {
        const res = await post(server.base, `/oppdrag/${id}/godta`, { cookie: t.cookie });
        results.push(res.status);
      }

      check('de tre første kan tas', results.slice(0, 3).every((s) => s === 201), results.join(','));
      check('det fjerde avvises', results[3] === 400, `${results[3]}`);

      const count = await prisma.mission.count({
        where: { playerId: t.player.id, status: 'AKTIV' },
      });
      check('nøyaktig tre er aktive', count === 3, `${count}`);

      const unknown = await post(server.base, '/oppdrag/finnes-ikke/godta', { cookie: t.cookie });
      check('et ukjent oppdrag gir 400 fra valideringen', unknown.status === 400, `${unknown.status}`);

      // A mission from somebody they have not met must answer exactly as one
      // that does not exist, or the id alone would map the contact network.
      const hidden = await post(server.base, '/oppdrag/jonas_siste_ordet/godta', {
        cookie: t.cookie,
      });
      check('et skjult oppdrag svarer som om det ikke finnes', hidden.status === 404, `${hidden.status}`);
    }

    /* ================================================================== */
    section('4. Framdrift kommer fra faktisk spilling');

    {
      // Crime. The mission observes the existing crime service rather than
      // duplicating it, so only a genuine success counts - and a failure costs
      // what it always cost, no more.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      await know(t.player.id, 'kraka', 30);
      await post(server.base, '/oppdrag/kraka_forste_tips/godta', { cookie: t.cookie });

      let successes = 0;
      let failures = 0;
      let tracked = true;

      for (let attempt = 0; attempt < 25 && successes < 2; attempt += 1) {
        await clearCrimeCooldowns(t.player.id);
        await prisma.player.update({
          where: { id: t.player.id },
          data: { energy: 50, health: 100 },
        });

        const res = await post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie });
        if (res.status !== 200) break;

        if (res.body.outcome.success) successes += 1;
        else failures += 1;

        const row = await missionRow(t.player.id, 'kraka_forste_tips');
        if (row?.progressCount !== Math.min(successes, 2)) tracked = false;
      }

      note(`${successes} vellykkede og ${failures} mislykkede forsøk`);
      check('telleren følger antall vellykkede forsøk, ikke antall klikk', tracked);
      check('to vellykkede forsøk ble oppnådd', successes >= 2, `${successes}`);

      const row = await missionRow(t.player.id, 'kraka_forste_tips');
      check('telleren står på målet', row?.progressCount === 2, `${row?.progressCount}`);

      await clearCrimeCooldowns(t.player.id);
      await prisma.player.update({ where: { id: t.player.id }, data: { energy: 50 } });
      await post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie });
      const capped = await missionRow(t.player.id, 'kraka_forste_tips');
      check('og løper ikke videre etterpå', capped?.progressCount === 2, `${capped?.progressCount}`);

      const list = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const dto = findDto(list.body, 'kraka_forste_tips');
      check('oppdraget står som klart til levering', dto?.deliverable === true);
      check('og telles i merket i menyen', list.body.deliverableCount === 1,
        `${list.body.deliverableCount}`);
      check('framdriften vises som to av to', dto?.objectives?.[0]?.actual === '2 av 2',
        dto?.objectives?.[0]?.actual);
    }

    {
      // A crime in the wrong district must not count: the mission named a place.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum' });
      await know(t.player.id, 'kraka', 30);
      await post(server.base, '/oppdrag/kraka_forste_tips/godta', { cookie: t.cookie });

      for (let i = 0; i < 4; i += 1) {
        await clearCrimeCooldowns(t.player.id);
        await prisma.player.update({ where: { id: t.player.id }, data: { energy: 50 } });
        await post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie });
      }

      const row = await missionRow(t.player.id, 'kraka_forste_tips');
      check('kriminalitet i feil distrikt teller ikke', row?.progressCount === 0,
        `${row?.progressCount}`);
    }

    {
      // Exploration. A round that turns up nothing is still a round walked.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'havna' });
      await know(t.player.id, 'mette_dal', 30);
      await post(server.base, '/oppdrag/mette_ryktet/godta', { cookie: t.cookie });

      await prisma.player.update({
        where: { id: t.player.id },
        data: { lastExploredAt: null, energy: 50 },
      });
      const explored = await post(server.base, '/informasjon/utforsk', { cookie: t.cookie });
      check('utforsking svarer', explored.status === 200, `${explored.status}`);

      const row = await missionRow(t.player.id, 'mette_ryktet');
      check('utforsking teller mot oppdraget', row?.progressCount === 1, `${row?.progressCount}`);

      const list = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const dto = findDto(list.body, 'mette_ryktet');
      const knowledge = dto?.objectives?.find((o: any) => o.kind === 'KUNNSKAP');
      check('oppdraget har også et kunnskapsmål', Boolean(knowledge));
      check(
        'kunnskapsmålet er en egen ting fra å gå runden',
        knowledge?.target === 1 && dto?.objectives?.length === 2,
      );
    }

    {
      // Knowledge is knowledge: held in the information table, never carried,
      // never occupying an inventory slot, never consumed by being checked.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'havna' });
      await know(t.player.id, 'mette_dal', 30);
      await post(server.base, '/oppdrag/mette_ryktet/godta', { cookie: t.cookie });

      const info = await prisma.information.create({
        data: {
          ownerId: t.player.id,
          type: 'ETTERRETNING',
          source: 'OBSERVASJON',
          relevance: 'AKTIVITET',
          title: 'Aktivitet på kaia',
          content: 'Noe skjer ved containerne.',
          districtId: 'havna',
          reliability: 80,
          isTrue: true,
          baseValue: 300,
          expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
        },
      });

      const list = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const knowledge = findDto(list.body, 'mette_ryktet')
        ?.objectives?.find((o: any) => o.kind === 'KUNNSKAP');
      check('fersk, relevant kunnskap oppfyller målet', knowledge?.met === true,
        knowledge?.actual);

      const stillThere = await prisma.information.findUnique({ where: { id: info.id } });
      check('å sjekke hva du vet bruker det ikke opp', stillThere?.usedAt === null);

      const inventory = await get(server.base, '/inventar', { cookie: t.cookie });
      check('kunnskap er ikke en gjenstand i inventaret',
        (inventory.body?.carried ?? []).length === 0,
        `${(inventory.body?.carried ?? []).length}`);

      // Wrong district is wrong knowledge, however fresh it is.
      await prisma.information.update({
        where: { id: info.id },
        data: { districtId: 'neon' },
      });
      const moved = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const after = findDto(moved.body, 'mette_ryktet')
        ?.objectives?.find((o: any) => o.kind === 'KUNNSKAP');
      check('kunnskap om feil sted teller ikke', after?.met === false, after?.actual);

      // Spent knowledge is no longer knowledge you can trade on.
      await prisma.information.update({
        where: { id: info.id },
        data: { districtId: 'havna', usedAt: new Date() },
      });
      const used = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const spent = findDto(used.body, 'mette_ryktet')
        ?.objectives?.find((o: any) => o.kind === 'KUNNSKAP');
      check('oppbrukt informasjon teller ikke', spent?.met === false, spent?.actual);
    }

    {
      // Talking. One action moves both trust and mission progress.
      const t = await createTestPlayer({ ...atLevel(6), currentDistrictId: 'blokkene', heat: 10 });
      await know(t.player.id, 'sara_viken', 40);
      await know(t.player.id, 'karin_five', 45);
      await prisma.mission.create({
        data: {
          playerId: t.player.id,
          missionId: 'sara_advarselen',
          contactId: 'sara_viken',
          status: 'FULLFORT',
          completedAt: new Date(),
        },
      });

      const taken = await post(server.base, '/oppdrag/karin_dossieret/godta', { cookie: t.cookie });
      check('et kjedeledd kan tas når forrige er fullført', taken.status === 201, `${taken.status}`);

      await prisma.player.update({ where: { id: t.player.id }, data: { energy: 50 } });
      await post(server.base, '/kontakter/kontakt', {
        cookie: t.cookie,
        body: { contactId: 'karin_five' },
      });
      const one = await missionRow(t.player.id, 'karin_dossieret');
      check('en prat teller', one?.progressCount === 1, `${one?.progressCount}`);

      await post(server.base, '/kontakter/kontakt', {
        cookie: t.cookie,
        body: { contactId: 'sara_viken' },
      });
      const other = await missionRow(t.player.id, 'karin_dossieret');
      check('men en prat med feil person teller ikke', other?.progressCount === 1,
        `${other?.progressCount}`);
    }

    {
      // Banking. The counter moves with the money, in the same transaction.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum', cash: 20000 });
      await know(t.player.id, 'nina_solberg', 30);
      await post(server.base, '/oppdrag/nina_visningen/godta', { cookie: t.cookie });

      await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 2000 },
      });
      const partial = await missionRow(t.player.id, 'nina_visningen');
      check('et innskudd teller med beløpet sitt', partial?.progressCount === 2000,
        `${partial?.progressCount}`);

      const list = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const dto = findDto(list.body, 'nina_visningen');
      check('framdriften vises i kroner', dto?.objectives?.[0]?.actual?.includes('kr'),
        dto?.objectives?.[0]?.actual);
      check('og oppdraget er ikke klart ennå', dto?.deliverable === false);

      await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 3000 },
      });
      const after = await get(server.base, '/oppdrag', { cookie: t.cookie });
      check('innskudd legges sammen til målet er nådd',
        findDto(after.body, 'nina_visningen')?.deliverable === true);

      // Missions must never be a way to conjure kroner: the money really moved.
      const player = await reload(t.player.id);
      check('pengene står faktisk på konto', player.bankBalance === 5000, `${player.bankBalance}`);
      check('og er trukket fra kontantene', player.cash === 15000, `${player.cash}`);
    }

    {
      // Driving. Moving a car is not the same as going somewhere yourself, and
      // the mission asks for both.
      const t = await createTestPlayer({
        ...atLevel(5),
        currentDistrictId: 'havna',
        cash: 200000,
      });
      await know(t.player.id, 'gunnar_toft', 30);
      await know(t.player.id, 'marius_mekken', 30);
      await prisma.mission.create({
        data: {
          playerId: t.player.id,
          missionId: 'gunnar_lykta',
          contactId: 'gunnar_toft',
          status: 'FULLFORT',
          completedAt: new Date(),
        },
      });

      const bought = await post(server.base, '/kjoretoy/kjop', {
        cookie: t.cookie,
        body: { vehicleTypeId: 'bruktbil', name: 'Grå varebil' },
      });
      check('kjøretøyet ble kjøpt', bought.status === 201, `${bought.status}`);
      const vehicleId = bought.body?.vehicle?.id;

      const taken = await post(server.base, '/oppdrag/marius_bilen/godta', { cookie: t.cookie });
      check('transportoppdraget kan tas når man eier en bil', taken.status === 201,
        JSON.stringify(taken.body?.error ?? {}));

      await post(server.base, '/kjoretoy/aktiver', { cookie: t.cookie, body: { vehicleId } });
      const moved = await post(server.base, '/kjoretoy/flytt', {
        cookie: t.cookie,
        body: { vehicleId, destinationDistrictId: 'industrien' },
      });
      check('bilen ble kjørt til Industrien', moved.status === 200, `${moved.status}`);

      const row = await missionRow(t.player.id, 'marius_bilen');
      check('kjøreturen teller mot oppdraget', row?.progressCount === 1, `${row?.progressCount}`);

      const midway = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const dto = findDto(midway.body, 'marius_bilen');
      check('men oppdraget er ikke ferdig - du står fortsatt i Havna',
        dto?.deliverable === false);
      const beThere = dto?.objectives?.find((o: any) => o.kind === 'VAER_I');
      check('og det står svart på hvitt hvor du er', beThere?.actual?.includes('Havna'),
        beThere?.actual);

      await post(server.base, '/by/flytt', {
        cookie: t.cookie,
        body: { districtId: 'industrien' },
      });
      const ready = await get(server.base, '/oppdrag', { cookie: t.cookie });
      check('når du selv kommer etter, er oppdraget klart',
        findDto(ready.body, 'marius_bilen')?.deliverable === true);
    }

    /* ================================================================== */
    section('5. Levering');

    {
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      await know(t.player.id, 'kraka', 30);
      await post(server.base, '/oppdrag/kraka_forste_tips/godta', { cookie: t.cookie });

      // Handing in unfinished work is an explanation, not a punishment.
      const early = await post(server.base, '/oppdrag/kraka_forste_tips/lever', {
        cookie: t.cookie,
      });
      check('et uferdig oppdrag kan ikke leveres', early.status === 400, `${early.status}`);
      check('feilen sier hva som gjenstår', /lommetyveri/i.test(early.body?.error?.message ?? ''),
        early.body?.error?.message);
      const stillActive = await missionRow(t.player.id, 'kraka_forste_tips');
      check('og oppdraget forblir aktivt', stillActive?.status === 'AKTIV', stillActive?.status);

      let successes = 0;
      for (let i = 0; i < 25 && successes < 2; i += 1) {
        await clearCrimeCooldowns(t.player.id);
        await prisma.player.update({
          where: { id: t.player.id },
          data: { energy: 50, health: 100 },
        });
        const res = await post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie });
        if (res.status === 200 && res.body.outcome.success) successes += 1;
      }

      const before = await reload(t.player.id);
      const trustBefore = await prisma.contactRelationship.findFirstOrThrow({
        where: { playerId: t.player.id, contactId: 'kraka' },
      });

      const delivered = await post(server.base, '/oppdrag/kraka_forste_tips/lever', {
        cookie: t.cookie,
      });
      check('oppdraget kan leveres', delivered.status === 200,
        JSON.stringify(delivered.body?.error ?? {}));

      const definition = findMission('kraka_forste_tips')!;
      check('betalingen er katalogens, ikke klientens',
        delivered.body.cash === definition.rewards.cash, `${delivered.body.cash}`);
      check('XP er katalogens', delivered.body.xpGained === definition.rewards.xp);
      check('sluttreplikken kommer først nå', typeof delivered.body.debriefing === 'string' &&
        delivered.body.debriefing.length > 10);
      check('og den er på norsk', /[æøåÆØÅ]/.test(delivered.body.debriefing ?? ''));

      const after = await reload(t.player.id);
      check('pengene kom inn', after.cash === before.cash + definition.rewards.cash,
        `${after.cash - before.cash}`);
      check('XP kom inn', after.xp === before.xp + definition.rewards.xp,
        `${after.xp - before.xp}`);

      const trustAfter = await prisma.contactRelationship.findFirstOrThrow({
        where: { playerId: t.player.id, contactId: 'kraka' },
      });
      check('tilliten steg', trustAfter.trust === trustBefore.trust + definition.rewards.trust,
        `${trustAfter.trust - trustBefore.trust}`);
      check('og svaret melder det', delivered.body.trustGained === definition.rewards.trust);
    }

    {
      // Money only ever moves through the ledger, and only once.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum', cash: 20000 });
      await know(t.player.id, 'nina_solberg', 30);
      await post(server.base, '/oppdrag/nina_visningen/godta', { cookie: t.cookie });
      await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 5000 },
      });

      const delivered = await post(server.base, '/oppdrag/nina_visningen/lever', {
        cookie: t.cookie,
      });
      check('oppdraget ble levert', delivered.status === 200,
        JSON.stringify(delivered.body?.error ?? {}));

      const player = await reload(t.player.id);
      const entry = await prisma.transaction.findFirst({
        where: { playerId: t.player.id, type: 'OPPDRAG' },
      });
      check('betalingen ble bokført', entry !== null);
      check('med riktig beløp', entry?.amount === 600, `${entry?.amount}`);
      check('på kontantene', entry?.ledger === 'CASH', entry?.ledger ?? '');
      check('med sporbar kilde', entry?.source === 'mission.nina_visningen', entry?.source ?? '');
      check('og en norsk beskrivelse', (entry?.description ?? '').includes('Visningen'),
        entry?.description ?? '');
      check('saldoen i bokføringen stemmer med spilleren',
        entry?.balanceAfter === player.cash, `${entry?.balanceAfter} vs ${player.cash}`);

      const row = await missionRow(t.player.id, 'nina_visningen');
      check('raden er fullført', row?.status === 'FULLFORT', row?.status ?? '');
      check('med et tidspunkt', row?.completedAt !== null);

      const twice = await post(server.base, '/oppdrag/nina_visningen/lever', { cookie: t.cookie });
      check('det kan ikke leveres igjen', twice.status === 409, `${twice.status}`);

      const payments = await prisma.transaction.count({
        where: { playerId: t.player.id, type: 'OPPDRAG' },
      });
      check('og det ble betalt nøyaktig én gang', payments === 1, `${payments}`);

      const list = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const dto = findDto(list.body, 'nina_visningen');
      check('oppdraget står som fullført', dto?.availability === 'FULLFORT', dto?.availability);
      check('og sluttreplikken er nå synlig', typeof dto?.debriefing === 'string');

      const retake = await post(server.base, '/oppdrag/nina_visningen/godta', { cookie: t.cookie });
      check('et engangsoppdrag kan ikke tas om igjen', retake.status === 409, `${retake.status}`);
    }

    {
      // Requirements are checked again at delivery. Accepting is not a ticket.
      const t = await createTestPlayer({ ...atLevel(6), currentDistrictId: 'blokkene', heat: 5 });
      await know(t.player.id, 'sara_viken', 40);
      await know(t.player.id, 'karin_five', 45);
      await prisma.mission.create({
        data: {
          playerId: t.player.id,
          missionId: 'sara_advarselen',
          contactId: 'sara_viken',
          status: 'FULLFORT',
          completedAt: new Date(),
        },
      });

      const taken = await post(server.base, '/oppdrag/karin_dossieret/godta', { cookie: t.cookie });
      check('oppdraget ble tatt mens kravene var oppfylt', taken.status === 201, `${taken.status}`);

      // Karin will not talk to somebody the whole city is looking at.
      await prisma.player.update({ where: { id: t.player.id }, data: { heat: 90 } });

      const refused = await post(server.base, '/oppdrag/karin_dossieret/lever', {
        cookie: t.cookie,
      });
      check('leveringen avvises når et krav er brutt i mellomtiden',
        refused.status === 403, `${refused.status}`);
      check('og feilen sier både kravet og spillerens tall',
        /Heat.*25/i.test(refused.body?.error?.message ?? '') &&
          /90/.test(refused.body?.error?.message ?? ''),
        refused.body?.error?.message);

      const row = await missionRow(t.player.id, 'karin_dossieret');
      check('oppdraget står fortsatt som aktivt', row?.status === 'AKTIV', row?.status ?? '');
      const paid = await prisma.transaction.count({
        where: { playerId: t.player.id, type: 'OPPDRAG' },
      });
      check('og ingenting ble utbetalt', paid === 0, `${paid}`);
    }

    /* ================================================================== */
    section('6. Opplåsing er en ekte belønning');

    {
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene', heat: 0 });
      await know(t.player.id, 'kraka', 30);
      await prisma.mission.create({
        data: {
          playerId: t.player.id,
          missionId: 'kraka_forste_tips',
          contactId: 'kraka',
          status: 'FULLFORT',
          completedAt: new Date(),
        },
      });

      const list = await get(server.base, '/oppdrag', { cookie: t.cookie });
      check('kjedeleddet dukket opp da forrige ble fullført',
        findDto(list.body, 'kraka_butikken')?.availability === 'TILGJENGELIG',
        findDto(list.body, 'kraka_butikken')?.availability);

      const knownBefore = await prisma.contactRelationship.count({
        where: { playerId: t.player.id },
      });
      check('spilleren kjenner bare én person før leveringen', knownBefore === 1, `${knownBefore}`);

      await post(server.base, '/oppdrag/kraka_butikken/godta', { cookie: t.cookie });

      let done = false;
      for (let i = 0; i < 30 && !done; i += 1) {
        await clearCrimeCooldowns(t.player.id);
        await prisma.player.update({
          where: { id: t.player.id },
          data: { energy: 50, health: 100, heat: 0 },
        });
        const res = await post(server.base, '/kriminalitet/butikktyveri', { cookie: t.cookie });
        if (res.status === 200 && res.body.outcome.success) done = true;
      }
      check('butikktyveriet lyktes til slutt', done);

      await prisma.player.update({ where: { id: t.player.id }, data: { heat: 5 } });
      const delivered = await post(server.base, '/oppdrag/kraka_butikken/lever', {
        cookie: t.cookie,
      });
      check('oppdraget kunne leveres', delivered.status === 200,
        JSON.stringify(delivered.body?.error ?? {}));

      // Unlocking a contact changes the player's world, it is not a flag.
      check('svaret navngir hvem som åpnet seg',
        (delivered.body.unlockedContacts ?? []).includes('Oskar Lind'),
        JSON.stringify(delivered.body.unlockedContacts));

      const oskar = await prisma.contactRelationship.findFirst({
        where: { playerId: t.player.id, contactId: 'oskar_lind' },
      });
      check('og det ble en faktisk relasjon i databasen', oskar !== null);
      check('som starter der alle andre starter', oskar?.trust === 10, `${oskar?.trust}`);

      const after = await get(server.base, '/oppdrag', { cookie: t.cookie });
      check('nå er Oskars oppdrag synlig', findDto(after.body, 'oskar_laset') !== undefined);
      check('men låst til tilliten er bygget',
        findDto(after.body, 'oskar_laset')?.availability === 'LAAST',
        findDto(after.body, 'oskar_laset')?.availability);
    }

    {
      // A reward in knowledge is knowledge: a row in the information table,
      // guaranteed relevant and current, from a named person.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum', heat: 30 });
      await know(t.player.id, 'sara_viken', 40);

      const taken = await post(server.base, '/oppdrag/sara_advarselen/godta', { cookie: t.cookie });
      check('Saras oppdrag kan tas med høy heat', taken.status === 201,
        JSON.stringify(taken.body?.error ?? {}));

      await prisma.player.update({ where: { id: t.player.id }, data: { heat: 4 } });
      const delivered = await post(server.base, '/oppdrag/sara_advarselen/lever', {
        cookie: t.cookie,
      });
      check('og leveres når heaten er nede', delivered.status === 200,
        JSON.stringify(delivered.body?.error ?? {}));
      check('svaret melder at du fikk vite noe', delivered.body.informationGiven === true);
      check('men ingen penger, for dette var en tjeneste', delivered.body.cash === 0);

      const info = await prisma.information.findFirst({
        where: { ownerId: t.player.id, source: 'KONTAKT' },
      });
      check('kunnskapen ligger i informasjonstabellen', info !== null);
      check('med relevansen oppdraget lovet', info?.relevance === 'POLITI', info?.relevance ?? '');
      check('om riktig distrikt', info?.districtId === 'sentrum', info?.districtId ?? '');
      check('den er navngitt etter den som ga den', (info?.title ?? '').includes('Sara'),
        info?.title ?? '');
      check('den er fersk', info?.expiresAt !== null && info!.expiresAt! > new Date());
      check('og ubrukt', info?.usedAt === null);

      // Nothing of the kind ended up in the inventory: knowledge is not cargo.
      const inventory = await get(server.base, '/inventar', { cookie: t.cookie });
      check('ingenting havnet i inventaret', (inventory.body?.carried ?? []).length === 0);

      const shown = await get(server.base, `/informasjon/${info!.id}`, { cookie: t.cookie });
      check('spilleren kan lese den', shown.status === 200, `${shown.status}`);
      check('men får aldri vite om den er sann',
        !Object.prototype.hasOwnProperty.call(shown.body?.information ?? {}, 'isTrue'),
        Object.keys(shown.body?.information ?? {}).join(','));
    }

    /* ================================================================== */
    section('7. Samtidighet mot ekte PostgreSQL');

    {
      // Twenty simultaneous deliveries of one mission. The claim happens before
      // any money moves, so exactly one may pay.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum', cash: 20000 });
      await know(t.player.id, 'nina_solberg', 30);
      await post(server.base, '/oppdrag/nina_visningen/godta', { cookie: t.cookie });
      await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 5000 },
      });

      const before = await reload(t.player.id);
      const results = await burst(20, () =>
        post(server.base, '/oppdrag/nina_visningen/lever', { cookie: t.cookie }),
      );

      const ok = results.filter((r) => r.status === 200).length;
      const rejected = results.filter((r) => r.status === 409).length;
      note(`${ok} lyktes, ${rejected} ble avvist`);
      check('nøyaktig én levering lyktes', ok === 1, `${ok}`);
      check('resten ble avvist som allerede levert', ok + rejected === 20, `${ok}/${rejected}`);

      const after = await reload(t.player.id);
      check('spilleren ble betalt nøyaktig én gang',
        after.cash === before.cash + 600, `${after.cash - before.cash}`);
      check('XP ble gitt nøyaktig én gang', after.xp === before.xp + 45,
        `${after.xp - before.xp}`);

      const payments = await prisma.transaction.count({
        where: { playerId: t.player.id, type: 'OPPDRAG' },
      });
      check('det finnes én bokføring', payments === 1, `${payments}`);

      const rows = await prisma.mission.count({
        where: { playerId: t.player.id, missionId: 'nina_visningen', status: 'FULLFORT' },
      });
      check('og én fullført rad', rows === 1, `${rows}`);
    }

    {
      // Twenty simultaneous accepts of the same mission. The partial unique
      // index is the guarantee, not the count.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      await know(t.player.id, 'kraka', 30);

      const results = await burst(20, () =>
        post(server.base, '/oppdrag/kraka_forste_tips/godta', { cookie: t.cookie }),
      );
      const ok = results.filter((r) => r.status === 201).length;
      note(`${ok} av 20 samtidige forsøk opprettet en rad`);
      check('nøyaktig ett forsøk opprettet oppdraget', ok === 1, `${ok}`);

      const rows = await prisma.mission.count({
        where: { playerId: t.player.id, missionId: 'kraka_forste_tips' },
      });
      check('det finnes bare én rad', rows === 1, `${rows}`);
    }

    {
      // Ten simultaneous accepts of ten different missions must respect the cap.
      const t = await createTestPlayer({ ...atLevel(6), currentDistrictId: 'sentrum', cash: 90000 });
      for (const id of ['kraka', 'gunnar_toft', 'mette_dal', 'sara_viken', 'nina_solberg', 'tommy_ravn']) {
        await know(t.player.id, id, 45);
      }

      const ids = [
        'kraka_forste_tips',
        'gunnar_lykta',
        'mette_ryktet',
        'sara_advarselen',
        'nina_visningen',
        'tommy_neonlysene',
      ];
      await prisma.player.update({ where: { id: t.player.id }, data: { heat: 25 } });

      const results = await burst(ids.length, (i) =>
        post(server.base, `/oppdrag/${ids[i]}/godta`, { cookie: t.cookie }),
      );
      const ok = results.filter((r) => r.status === 201).length;
      note(`${ok} av ${ids.length} samtidige forsøk slapp gjennom`);

      const active = await prisma.mission.count({
        where: { playerId: t.player.id, status: 'AKTIV' },
      });
      check('aldri flere enn tre aktive, uansett hvor mange som prøver samtidig',
        active <= MISSION_TUNING.maxActive, `${active}`);
      check('og svarene stemmer med databasen', ok === active, `${ok} vs ${active}`);
    }

    {
      // Progress under parallel load: every success must be counted once.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      await know(t.player.id, 'rune_bakken', 45);
      await know(t.player.id, 'kraka', 30);
      await post(server.base, '/oppdrag/kraka_forste_tips/godta', { cookie: t.cookie });

      await prisma.player.update({
        where: { id: t.player.id },
        data: { energy: 100, maxEnergy: 100 },
      });

      const results = await burst(20, async () => {
        await clearCrimeCooldowns(t.player.id);
        return post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie });
      });

      const successes = results.filter((r) => r.status === 200 && r.body?.outcome?.success).length;
      const row = await missionRow(t.player.id, 'kraka_forste_tips');
      note(`${successes} vellykkede forsøk under parallell last`);
      check('telleren overstiger aldri målet',
        (row?.progressCount ?? 0) <= 2, `${row?.progressCount}`);
      check('og er aldri negativ', (row?.progressCount ?? 0) >= 0, `${row?.progressCount}`);
      check('og den mister ingen framgang når det faktisk skjedde noe',
        successes === 0 || (row?.progressCount ?? 0) === Math.min(successes, 2),
        `${row?.progressCount} mot ${successes}`);
    }

    {
      // Abandoning is also a claim: two requests cannot both walk away.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      await know(t.player.id, 'kraka', 30);
      await post(server.base, '/oppdrag/kraka_forste_tips/godta', { cookie: t.cookie });

      const results = await burst(10, () =>
        post(server.base, '/oppdrag/kraka_forste_tips/avbryt', { cookie: t.cookie }),
      );
      const ok = results.filter((r) => r.status === 200).length;
      check('nøyaktig ett avbrudd lyktes', ok === 1, `${ok}`);

      const rows = await prisma.mission.findMany({
        where: { playerId: t.player.id, missionId: 'kraka_forste_tips' },
      });
      check('raden står som avbrutt', rows[0]?.status === 'AVBRUTT', rows[0]?.status ?? '');
      check('og det ble ikke laget flere rader', rows.length === 1, `${rows.length}`);

      const retake = await post(server.base, '/oppdrag/kraka_forste_tips/godta', {
        cookie: t.cookie,
      });
      check('oppdraget er sperret en stund etterpå', retake.status === 409, `${retake.status}`);
      check('og spilleren får vite hvorfor',
        /forlot/i.test(retake.body?.error?.message ?? ''), retake.body?.error?.message);
    }

    /* ================================================================== */
    section('8. Sikkerhet');

    {
      const mine = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      const other = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      await know(mine.player.id, 'kraka', 30);
      await know(other.player.id, 'kraka', 30);

      await post(server.base, '/oppdrag/kraka_forste_tips/godta', { cookie: other.cookie });

      // One player's progress is invisible to another, and cannot be delivered
      // by them.
      const seen = await get(server.base, '/oppdrag/kraka_forste_tips', { cookie: mine.cookie });
      check('en annens oppdrag ses ikke som aktivt', seen.body?.mission?.availability !== 'AKTIV',
        seen.body?.mission?.availability);
      check('og har ingen framdrift', seen.body?.mission?.progressCount === 0);

      const steal = await post(server.base, '/oppdrag/kraka_forste_tips/lever', {
        cookie: mine.cookie,
      });
      check('og kan ikke leveres av noen andre', steal.status === 409, `${steal.status}`);

      const rows = await prisma.mission.count({ where: { playerId: other.player.id } });
      check('den andres rad er urørt', rows === 1, `${rows}`);
    }

    {
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum', cash: 20000 });
      await know(t.player.id, 'nina_solberg', 30);

      // Anything the client puts in the body is dropped: a mission carries no
      // client-supplied numbers at all.
      const accepted = await post(server.base, '/oppdrag/nina_visningen/godta', {
        cookie: t.cookie,
        body: {
          cash: 9999999,
          xp: 500000,
          rewards: { cash: 9999999 },
          progressCount: 99,
          status: 'FULLFORT',
          playerId: 'noen-andre',
        },
      });
      check('en forespørsel full av påstander godtas som et vanlig kall',
        accepted.status === 201, `${accepted.status}`);

      const row = await missionRow(t.player.id, 'nina_visningen');
      check('men framdriften er null', row?.progressCount === 0, `${row?.progressCount}`);
      check('statusen er aktiv, ikke fullført', row?.status === 'AKTIV', row?.status ?? '');
      check('og raden tilhører den som sendte kallet', row?.playerId === t.player.id);

      await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 5000 },
      });
      const delivered = await post(server.base, '/oppdrag/nina_visningen/lever', {
        cookie: t.cookie,
        body: { cash: 9999999, xpGained: 500000 },
      });
      check('leveringen betaler katalogens beløp', delivered.body?.cash === 600,
        `${delivered.body?.cash}`);

      const player = await reload(t.player.id);
      check('og spilleren har ikke fått en krone mer',
        player.cash === 15000 + 600, `${player.cash}`);
    }

    {
      // No internal state may cross the wire.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      await know(t.player.id, 'kraka', 30);

      const list = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const raw = JSON.stringify(list.body);

      for (const secret of ['passwordHash', 'usernameLower', 'isTrue', 'reliability', 'token']) {
        check(`svaret inneholder ikke ${secret}`, !raw.includes(secret));
      }

      // Contact reliability is the one number the whole information system
      // depends on staying hidden.
      const contact = (list.body.missions ?? [])[0];
      check('oppdragsgiveren sendes med navn og rolle', typeof contact?.contactName === 'string' &&
        typeof contact?.contactTypeLabel === 'string');
      check('men uten påliteligheten sin',
        !Object.prototype.hasOwnProperty.call(contact ?? {}, 'reliability'));
    }

    {
      const t = await createTestPlayer({ ...atLevel(3) });

      const unauth = await get(server.base, '/oppdrag');
      check('uten økt er svaret 401', unauth.status === 401, `${unauth.status}`);
      check('og sier ingenting om hvorfor internt',
        unauth.body?.error?.code === 'IKKE_AUTENTISERT', unauth.body?.error?.code);

      const bad = await post(server.base, '/oppdrag/../../etc/passwd/godta', { cookie: t.cookie });
      check('en id som ikke er en id avvises', bad.status === 400 || bad.status === 404,
        `${bad.status}`);

      const unknown = await get(server.base, '/oppdrag/finnes-ikke', { cookie: t.cookie });
      check('et ukjent oppdrag gir en norsk feil', unknown.status === 400,
        `${unknown.status}`);
      check('uten stacktrace', !/at |node_modules|prisma/i.test(JSON.stringify(unknown.body)));
    }

    {
      // The write limit protects the row lock from a script.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      await know(t.player.id, 'kraka', 30);

      const results = await burst(40, () =>
        post(server.base, '/oppdrag/kraka_forste_tips/avbryt', { cookie: t.cookie }),
      );
      const limited = results.filter((r) => r.status === 429).length;
      note(`${limited} av 40 forespørsler ble bremset`);
      check('for mange skrivinger på rad blir bremset', limited > 0, `${limited}`);
      check('og bremsen svarer på norsk',
        /vent/i.test(results.find((r) => r.status === 429)?.body?.error?.message ?? ''),
        results.find((r) => r.status === 429)?.body?.error?.message);
    }

    /* ================================================================== */
    section('9. Rullback ved ekte feil');

    {
      // A genuine database failure, not a mock: a temporary constraint makes
      // the payout impossible, and the whole delivery must come apart.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum', cash: 20000 });
      await know(t.player.id, 'nina_solberg', 30);
      await post(server.base, '/oppdrag/nina_visningen/godta', { cookie: t.cookie });
      await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 5000 },
      });

      const before = await reload(t.player.id);
      const trustBefore = await prisma.contactRelationship.findFirstOrThrow({
        where: { playerId: t.player.id, contactId: 'nina_solberg' },
      });

      // NOT VALID so the constraint applies only to rows written from here on:
      // earlier sections in this suite legitimately booked mission payments,
      // and the point is to break the *next* one.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "transactions" ADD CONSTRAINT "qa_block_mission_pay" ` +
          `CHECK ("type" <> 'OPPDRAG') NOT VALID`,
      );

      try {
        const failed = await post(server.base, '/oppdrag/nina_visningen/lever', {
          cookie: t.cookie,
        });
        check('leveringen feiler når bokføringen ikke går gjennom',
          failed.status >= 400, `${failed.status}`);
        check('og feilen lekker ingen interne detaljer',
          !/prisma|constraint|CHECK/i.test(JSON.stringify(failed.body)),
          JSON.stringify(failed.body).slice(0, 120));
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "transactions" DROP CONSTRAINT "qa_block_mission_pay"`,
        );
      }

      const after = await reload(t.player.id);
      const row = await missionRow(t.player.id, 'nina_visningen');
      const trustAfter = await prisma.contactRelationship.findFirstOrThrow({
        where: { playerId: t.player.id, contactId: 'nina_solberg' },
      });

      check('oppdraget står fortsatt som aktivt', row?.status === 'AKTIV', row?.status ?? '');
      check('det er ikke stemplet fullført', row?.completedAt === null);
      check('pengene er urørt', after.cash === before.cash, `${after.cash} vs ${before.cash}`);
      check('XP er urørt', after.xp === before.xp, `${after.xp} vs ${before.xp}`);
      check('tilliten er urørt', trustAfter.trust === trustBefore.trust,
        `${trustAfter.trust} vs ${trustBefore.trust}`);

      const payments = await prisma.transaction.count({
        where: { playerId: t.player.id, type: 'OPPDRAG' },
      });
      check('og ingen bokføring ble stående igjen', payments === 0, `${payments}`);

      // With the constraint gone, the same delivery must now work: the failure
      // left nothing broken behind it.
      const retry = await post(server.base, '/oppdrag/nina_visningen/lever', { cookie: t.cookie });
      check('leveringen går gjennom når hindringen er borte', retry.status === 200,
        JSON.stringify(retry.body?.error ?? {}));
    }

    /* ================================================================== */
    section('10. Resten av spillet er uendret');

    {
      // A player with no missions at all must experience the five hooked
      // services exactly as before.
      const t = await createTestPlayer({
        ...atLevel(5),
        currentDistrictId: 'sentrum',
        cash: 100000,
      });

      const missions = await prisma.mission.count({ where: { playerId: t.player.id } });
      check('spilleren har ingen oppdrag', missions === 0);

      await prisma.player.update({ where: { id: t.player.id }, data: { energy: 60 } });
      const crime = await post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie });
      check('kriminalitet svarer som før', crime.status === 200, `${crime.status}`);
      check('med et utfall', typeof crime.body?.outcome?.success === 'boolean');
      check('og med spilleren i svaret', typeof crime.body?.player?.cash === 'number');

      await prisma.player.update({
        where: { id: t.player.id },
        data: { lastExploredAt: null, energy: 60 },
      });
      const explore = await post(server.base, '/informasjon/utforsk', { cookie: t.cookie });
      check('utforsking svarer som før', explore.status === 200, `${explore.status}`);

      const deposit = await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 1000 },
      });
      check('innskudd svarer som før', deposit.status === 200, `${deposit.status}`);
      check('og har fortsatt både spiller og bokføring i svaret',
        typeof deposit.body?.player?.bankBalance === 'number' &&
          Array.isArray(deposit.body?.transactions));
      check('pengene flyttet seg riktig', deposit.body.player.bankBalance === 1000,
        `${deposit.body.player.bankBalance}`);

      const withdrawal = await post(server.base, '/spiller/bank/uttak', {
        cookie: t.cookie,
        body: { amount: 500 },
      });
      check('uttak er urørt', withdrawal.status === 200, `${withdrawal.status}`);

      await prisma.player.update({ where: { id: t.player.id }, data: { energy: 60 } });
      const discovered = await post(server.base, '/kontakter/oppdag', { cookie: t.cookie });
      check('å møte folk fungerer som før', discovered.status === 200, `${discovered.status}`);

      const bought = await post(server.base, '/kjoretoy/kjop', {
        cookie: t.cookie,
        body: { vehicleTypeId: 'moped', name: 'Rusten moped' },
      });
      check('kjøretøykjøp er urørt', bought.status === 201, `${bought.status}`);

      await post(server.base, '/kjoretoy/aktiver', {
        cookie: t.cookie,
        body: { vehicleId: bought.body.vehicle.id },
      });
      const moved = await post(server.base, '/kjoretoy/flytt', {
        cookie: t.cookie,
        body: { vehicleId: bought.body.vehicle.id, destinationDistrictId: 'havna' },
      });
      check('og kjøring er urørt', moved.status === 200, `${moved.status}`);
      check('bilen står der den ble kjørt',
        moved.body?.vehicle?.districtId === 'havna',
        moved.body?.vehicle?.districtId);

      const stillNone = await prisma.mission.count({ where: { playerId: t.player.id } });
      check('og ingenting har skapt oppdragsrader av seg selv', stillNone === 0, `${stillNone}`);
    }

    /* ================================================================== */
    section('11. Ferdighet som krav');

    {
      // The requirement reads the same PlayerSkill rows the skill screen spends
      // points into. There is no second progression, and a mission neither
      // grants nor consumes a point.
      const t = await createTestPlayer({
        ...atLevel(7),
        currentDistrictId: 'industrien',
        cash: 200000,
      });
      await know(t.player.id, 'elin_haug', 55);
      await know(t.player.id, 'marius_mekken', 55);
      await know(t.player.id, 'kraka', 30);

      const skillCondition = async () => {
        const list = await get(server.base, '/oppdrag', { cookie: t.cookie });
        const dto = findDto(list.body, 'elin_verkstedet');
        return {
          dto,
          condition: dto?.conditions?.find((c: any) => /Mobilitet/i.test(c.label)),
        };
      };

      // Chain prerequisite first, so the mission is visible at all.
      await prisma.mission.create({
        data: {
          playerId: t.player.id,
          missionId: 'marius_bilen',
          contactId: 'marius_mekken',
          status: 'FULLFORT',
          completedAt: new Date(),
        },
      });

      const untrained = await skillCondition();
      check('oppdraget viser ferdighetskravet', Boolean(untrained.condition),
        JSON.stringify(untrained.dto?.conditions ?? []));
      check('kravet er ikke oppfylt uten trening', untrained.condition?.met === false,
        `${untrained.condition?.met}`);
      check('og teksten sier hva som kreves', untrained.condition?.label?.includes('nivå 3'),
        untrained.condition?.label);
      check('og at du ikke har trent den', /ikke trent/i.test(untrained.condition?.actual ?? ''),
        untrained.condition?.actual);
      check('oppdraget er låst', untrained.dto?.availability === 'LAAST',
        untrained.dto?.availability);

      // Not quite enough is still not enough.
      await prisma.playerSkill.updateMany({
        where: { playerId: t.player.id, skillId: 'mobilitet' },
        data: { level: 2 },
      });
      const almost = await skillCondition();
      check('to av tre nivåer holder ikke', almost.condition?.met === false,
        almost.condition?.actual);
      check('og svaret viser ditt faktiske nivå', almost.condition?.actual === 'Din er nivå 2',
        almost.condition?.actual);

      await prisma.playerSkill.updateMany({
        where: { playerId: t.player.id, skillId: 'mobilitet' },
        data: { level: 3 },
      });
      const trained = await skillCondition();
      check('kravet er oppfylt på nivå 3', trained.condition?.met === true,
        trained.condition?.actual);

      // A higher level than asked for is fine.
      await prisma.playerSkill.updateMany({
        where: { playerId: t.player.id, skillId: 'mobilitet' },
        data: { level: 9 },
      });
      const over = await skillCondition();
      check('og på et høyere nivå', over.condition?.met === true, over.condition?.actual);

      // The wrong skill must not satisfy it.
      await prisma.playerSkill.updateMany({
        where: { playerId: t.player.id, skillId: 'mobilitet' },
        data: { level: 0 },
      });
      await prisma.playerSkill.updateMany({
        where: { playerId: t.player.id, skillId: 'kriminalitet' },
        data: { level: 20 },
      });
      const wrong = await skillCondition();
      check('en annen ferdighet oppfyller det ikke', wrong.condition?.met === false,
        wrong.condition?.actual);

      // And a mission that asks for no skill is untouched by any of this.
      const other = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const kraka = findDto(other.body, 'kraka_forste_tips');
      check('et oppdrag uten ferdighetskrav er upåvirket',
        kraka?.availability === 'TILGJENGELIG', kraka?.availability);
      check('og har ingen ferdighetslinje i kravene',
        !(kraka?.conditions ?? []).some((c: any) => /Mobilitet|Forretning/i.test(c.label)),
        JSON.stringify(kraka?.conditions ?? []));

      // Skill points are never touched by reading a requirement.
      const player = await reload(t.player.id);
      check('ingen ferdighetspoeng ble brukt av å sjekke kravet',
        player.skillPoints === t.player.skillPoints,
        `${player.skillPoints} vs ${t.player.skillPoints}`);
    }

    {
      // Blocking a delivery on a skill works the same as any other requirement.
      const definitions = MISSIONS.filter((m) => m.requirements.minSkill);
      check('minst ett oppdrag bruker ferdighetskravet', definitions.length >= 1,
        `${definitions.length}`);
      note(
        `oppdrag med ferdighetskrav: ${definitions
          .map((m) => `${m.id} (${m.requirements.minSkill!.skillId} ${m.requirements.minSkill!.level})`)
          .join(', ')}`,
      );

      // Only dormant skills are used, so no existing gameplay number changes.
      const used = definitions.map((m) => m.requirements.minSkill!.skillId);
      check('kravene bruker kun ferdigheter som ellers ikke gjør noe',
        used.every((id) => findSkill(id)?.dormant === true), used.join(','));
    }


    /* ================================================================== */
    section('12. Data for kontaktsiden og dashbordet');

    {
      // The contact page and the dashboard both read this one response. Neither
      // builds a mission structure of its own, so what they can show is exactly
      // what the server decided to send.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'blokkene' });
      await know(t.player.id, 'kraka', 30);
      await know(t.player.id, 'nina_solberg', 30);

      const list = await get(server.base, '/oppdrag', { cookie: t.cookie });

      check('hvert oppdrag bærer hvem som gir det',
        list.body.missions.every((m: any) => typeof m.contactId === 'string' && m.contactId),
        JSON.stringify(list.body.missions.map((m: any) => m.contactId)));
      check('og navnet deres, så siden slipper å slå det opp',
        list.body.missions.every((m: any) => typeof m.contactName === 'string' && m.contactName));
      check('og en norsk statusetikett',
        list.body.missions.every((m: any) => typeof m.availabilityLabel === 'string' &&
          m.availabilityLabel.length > 0));

      // Grouping by contact is what the contact page does; it must partition
      // cleanly with nothing left over.
      const byContact = new Map<string, any[]>();
      for (const m of list.body.missions) {
        byContact.set(m.contactId, [...(byContact.get(m.contactId) ?? []), m]);
      }
      const grouped = [...byContact.values()].reduce((sum, rows) => sum + rows.length, 0);
      check('gruppering per kontakt mister ingenting',
        grouped === list.body.missions.length, `${grouped} av ${list.body.missions.length}`);
      check('Kråka har minst ett oppdrag å vise', (byContact.get('kraka') ?? []).length >= 1,
        `${(byContact.get('kraka') ?? []).length}`);
      check('en person spilleren ikke kjenner har ingen',
        byContact.get('jonas_stray') === undefined);

      // The badge counts what can be handed in, not what is running. A number
      // that never changes is decoration.
      await post(server.base, '/oppdrag/kraka_forste_tips/godta', { cookie: t.cookie });
      const taken = await get(server.base, '/oppdrag', { cookie: t.cookie });
      check('et aktivt oppdrag telles som aktivt', taken.body.activeCount === 1,
        `${taken.body.activeCount}`);
      check('men merket står på null før noe er gjort', taken.body.deliverableCount === 0,
        `${taken.body.deliverableCount}`);

      const active = taken.body.missions.filter((m: any) => m.availability === 'AKTIV');
      check('dashbordet får det aktive oppdraget', active.length === 1, `${active.length}`);
      check('med et umøtt delmål å vise fram',
        active[0]?.objectives?.some((o: any) => !o.met));

      let successes = 0;
      for (let i = 0; i < 25 && successes < 2; i += 1) {
        await clearCrimeCooldowns(t.player.id);
        await prisma.player.update({
          where: { id: t.player.id },
          data: { energy: 50, health: 100 },
        });
        const res = await post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie });
        if (res.status === 200 && res.body.outcome.success) successes += 1;
      }

      const ready = await get(server.base, '/oppdrag', { cookie: t.cookie });
      check('merket slår inn først når noe faktisk kan leveres',
        ready.body.deliverableCount === 1, `${ready.body.deliverableCount}`);
      check('og antallet aktive er uendret', ready.body.activeCount === 1,
        `${ready.body.activeCount}`);

      const readyDto = findDto(ready.body, 'kraka_forste_tips');
      check('oppdraget er merket som klart', readyDto?.deliverable === true);
      check('og kontaktsiden ser det samme', readyDto?.contactId === 'kraka');

      await post(server.base, '/oppdrag/kraka_forste_tips/lever', { cookie: t.cookie });
      const after = await get(server.base, '/oppdrag', { cookie: t.cookie });
      check('etter levering er merket nullstilt', after.body.deliverableCount === 0,
        `${after.body.deliverableCount}`);
      check('og ingenting er aktivt lenger', after.body.activeCount === 0,
        `${after.body.activeCount}`);
      check('kontaktsiden viser det nå som fullført',
        findDto(after.body, 'kraka_forste_tips')?.availability === 'FULLFORT');
    }


    /* ================================================================== */
    section('13. Bankinnskudd og oppdragsteller kan aldri sprike');

    {
      // The deposit was restructured to open its own transaction so the counter
      // moves with the money. These checks prove the coupling is real in both
      // directions: no money without a count, no count without money.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum', cash: 3000 });
      await know(t.player.id, 'nina_solberg', 30);
      await post(server.base, '/oppdrag/nina_visningen/godta', { cookie: t.cookie });

      const tooMuch = await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 50000 },
      });
      check('et innskudd uten dekning avvises', tooMuch.status === 400, `${tooMuch.status}`);

      const afterFailure = await missionRow(t.player.id, 'nina_visningen');
      check('og teller ikke mot oppdraget', afterFailure?.progressCount === 0,
        `${afterFailure?.progressCount}`);

      const player = await reload(t.player.id);
      check('pengene står urørt', player.cash === 3000 && player.bankBalance === 0,
        `${player.cash}/${player.bankBalance}`);

      const rows = await prisma.transaction.count({
        where: { playerId: t.player.id, type: 'BANK_INNSKUDD' },
      });
      check('og ingen bokføring ble skrevet', rows === 0, `${rows}`);

      const ok = await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 1200 },
      });
      check('et gyldig innskudd går gjennom', ok.status === 200, `${ok.status}`);
      check('svaret har fortsatt samme form',
        typeof ok.body?.player?.bankBalance === 'number' &&
          Array.isArray(ok.body?.transactions) &&
          typeof ok.body?.message === 'string',
        JSON.stringify(Object.keys(ok.body ?? {})));
      check('og fortsatt to bokføringsrader per innskudd',
        ok.body.transactions.length === 2, `${ok.body.transactions.length}`);

      const moved = await missionRow(t.player.id, 'nina_visningen');
      check('telleren står på nøyaktig innskuddsbeløpet', moved?.progressCount === 1200,
        `${moved?.progressCount}`);

      const settled = await reload(t.player.id);
      check('og banksaldoen er den samme summen', settled.bankBalance === 1200,
        `${settled.bankBalance}`);
    }

    {
      // Concurrency: deposits are additive, not a claim. Every one that
      // succeeds must be counted exactly once, and the totals must agree.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum', cash: 10000 });
      await know(t.player.id, 'nina_solberg', 30);
      await post(server.base, '/oppdrag/nina_visningen/godta', { cookie: t.cookie });

      // Deliberately kept under the objective's 5000 kr target, because the
      // counter stops there by design. Below the cap, every krone that moved
      // must be counted exactly once - that is what a lost update would break.
      const results = await burst(8, () =>
        post(server.base, '/spiller/bank/innskudd', {
          cookie: t.cookie,
          body: { amount: 500 },
        }),
      );

      const ok = results.filter((r) => r.status === 200).length;
      note(`${ok} av 8 samtidige innskudd på 500 kr lyktes`);

      const player = await reload(t.player.id);
      const row = await missionRow(t.player.id, 'nina_visningen');

      check('alle innskudd med dekning gikk gjennom', ok === 8, `${ok}`);
      check('banksaldoen er summen av dem', player.bankBalance === ok * 500,
        `${player.bankBalance}`);
      check('kontantene er redusert tilsvarende', player.cash === 10000 - ok * 500,
        `${player.cash}`);
      check('og telleren mistet ingen av dem', row?.progressCount === ok * 500,
        `${row?.progressCount} mot ${ok * 500}`);

      const ledger = await prisma.transaction.count({
        where: { playerId: t.player.id, type: 'BANK_INNSKUDD' },
      });
      check('med to bokføringsrader per innskudd', ledger === ok * 2, `${ledger}`);

      // A deposit that overshoots the objective lands whole in the bank, but the
      // counter is credited only the shortfall and stops exactly on the target.
      // The money and the progress are two different questions.
      const over = await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 2000 },
      });
      check('et innskudd forbi målet går fortsatt gjennom', over.status === 200,
        `${over.status}`);

      const capped = await reload(t.player.id);
      const cappedRow = await missionRow(t.player.id, 'nina_visningen');
      check('hele beløpet havnet på konto', capped.bankBalance === ok * 500 + 2000,
        `${capped.bankBalance}`);
      check('men telleren stopper nøyaktig på målet', cappedRow?.progressCount === 5000,
        `${cappedRow?.progressCount}`);

      const before = cappedRow?.progressCount ?? 0;
      const again = await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 1000 },
      });
      check('og et innskudd etter det går også gjennom', again.status === 200, `${again.status}`);

      const settledRow = await missionRow(t.player.id, 'nina_visningen');
      check('men telleren rører seg ikke mer', settledRow?.progressCount === before,
        `${settledRow?.progressCount} mot ${before}`);

      const done = await get(server.base, '/oppdrag', { cookie: t.cookie });
      const dto = findDto(done.body, 'nina_visningen');
      check('oppdraget står som klart', dto?.deliverable === true);
      check('og framdriften vises som nøyaktig målet, ikke over',
        dto?.objectives?.[0]?.current === 5000, `${dto?.objectives?.[0]?.current}`);
      // Norwegian thousands separators are non-breaking spaces, so the text is
      // compared with whitespace normalised rather than byte for byte.
      const shown = (dto?.objectives?.[0]?.actual ?? '').replace(/\s/g, ' ');
      check('med norsk tusenskille i teksten', shown === '5 000 kr av 5 000 kr', shown);
    }

    {
      // The other direction: a failure inside the mission hook must take the
      // money with it. Forced with a real constraint, not a mock.
      const t = await createTestPlayer({ ...atLevel(3), currentDistrictId: 'sentrum', cash: 5000 });
      await know(t.player.id, 'nina_solberg', 30);
      await post(server.base, '/oppdrag/nina_visningen/godta', { cookie: t.cookie });

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "missions" ADD CONSTRAINT "qa_block_progress" ` +
          `CHECK ("progressCount" = 0) NOT VALID`,
      );

      let failed: { status: number; body: any };
      try {
        failed = await post(server.base, '/spiller/bank/innskudd', {
          cookie: t.cookie,
          body: { amount: 1000 },
        });
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "missions" DROP CONSTRAINT "qa_block_progress"`,
        );
      }

      check('innskuddet feiler når telleren ikke kan skrives', failed.status >= 400,
        `${failed.status}`);

      const player = await reload(t.player.id);
      check('og pengene ble ikke flyttet', player.cash === 5000 && player.bankBalance === 0,
        `${player.cash}/${player.bankBalance}`);

      const ledger = await prisma.transaction.count({
        where: { playerId: t.player.id, type: 'BANK_INNSKUDD' },
      });
      check('ingen bokføring ble stående igjen', ledger === 0, `${ledger}`);

      const row = await missionRow(t.player.id, 'nina_visningen');
      check('og telleren er urørt', row?.progressCount === 0, `${row?.progressCount}`);

      const retry = await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 1000 },
      });
      check('samme innskudd går gjennom etterpå', retry.status === 200, `${retry.status}`);
      const after = await missionRow(t.player.id, 'nina_visningen');
      check('og da teller det', after?.progressCount === 1000, `${after?.progressCount}`);
    }

    {
      // Withdrawal was left untouched by the restructure: same fee, same rows,
      // and it must never count towards a deposit objective.
      const t = await createTestPlayer({
        ...atLevel(3),
        currentDistrictId: 'sentrum',
        cash: 0,
        bankBalance: 10000,
      });
      await know(t.player.id, 'nina_solberg', 30);
      await post(server.base, '/oppdrag/nina_visningen/godta', { cookie: t.cookie });

      const out = await post(server.base, '/spiller/bank/uttak', {
        cookie: t.cookie,
        body: { amount: 1000 },
      });
      check('uttak fungerer som før', out.status === 200, `${out.status}`);

      const fee = await prisma.transaction.findFirst({
        where: { playerId: t.player.id, type: 'BANK_GEBYR' },
      });
      check('gebyret bokføres fortsatt som egen rad', fee !== null);
      check('og trekkes fra kontantene', fee !== null && fee.amount < 0, `${fee?.amount}`);

      const row = await missionRow(t.player.id, 'nina_visningen');
      check('et uttak teller ikke som et innskudd', row?.progressCount === 0,
        `${row?.progressCount}`);
    }


    /* ================================================================== */
    section('14. Telleren kan aldri overstige målet');

    {
      // The invariant, checked against every row this run produced rather than
      // against one hand-picked case. A counter above its target would mean the
      // stored number and the objective disagreed about what "ferdig" means.
      const rows = await prisma.mission.findMany({
        where: { player: { username: { startsWith: TEST_PREFIX } } },
        select: { missionId: true, progressCount: true, status: true },
      });

      note(`${rows.length} oppdragsrader ble laget i denne kjøringen`);
      check('det ble faktisk laget rader å sjekke', rows.length > 0, `${rows.length}`);

      const offenders: string[] = [];
      let counted = 0;

      for (const row of rows) {
        const mission = findMission(row.missionId);
        if (!mission) continue;

        const objective = eventObjectiveOf(mission);
        if (!objective) {
          // A mission with no counted action must never have moved at all.
          if (row.progressCount !== 0) {
            offenders.push(`${row.missionId}: ${row.progressCount} uten handlingsmål`);
          }
          continue;
        }

        counted += 1;
        const target = objectiveTarget(objective);
        if (row.progressCount > target) {
          offenders.push(`${row.missionId}: ${row.progressCount} > ${target}`);
        }
        if (row.progressCount < 0) {
          offenders.push(`${row.missionId}: ${row.progressCount} er negativ`);
        }
      }

      note(`${counted} av dem har et handlingsmål`);
      check('ingen teller står over målet sitt', offenders.length === 0,
        offenders.join(' | '));
      check('og ingen er negativ', !offenders.some((o) => o.includes('negativ')));

      // Any row that actually accumulated progress must sit exactly on its
      // target once finished - the whole point of crediting only the shortfall.
      //
      // Rows still at zero are excluded on purpose: several sections write a
      // FULLFORT row directly to satisfy a chain prerequisite, and those never
      // went through the game at all.
      const earned = rows.filter((row) => {
        const mission = findMission(row.missionId);
        const objective = mission ? eventObjectiveOf(mission) : undefined;
        return row.status === 'FULLFORT' && objective !== undefined && row.progressCount > 0;
      });

      const exact = earned.every((row) => {
        const objective = eventObjectiveOf(findMission(row.missionId)!)!;
        return row.progressCount === objectiveTarget(objective);
      });

      note(`${earned.length} fullførte oppdrag der framdriften faktisk ble spilt inn`);
      check('de står nøyaktig på målet, verken over eller under', exact,
        earned.map((r) => `${r.missionId}:${r.progressCount}`).join(','));
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
