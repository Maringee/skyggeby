/**
 * Integration tests for the skill system, against the real PostgreSQL database
 * and a real Express server.
 *
 * Run with `npm -w @skyggeby/server run test:skills`.
 */
import {
  INFORMATION_TUNING,
  SKILLS,
  SKILL_IDS,
  SKILL_TUNING,
  informationBonusPoints,
  skillCurve,
  skillPointsForLevelUp,
  totalSkillPointsForLevel,
  xpRequiredForLevel,
  type SkillId,
} from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/errors';
import { performCrime } from '../src/modules/crime/crime.service';
import { grantXp } from '../src/modules/player/progression.service';
import { getSkillEffect, getSkillEffects } from '../src/modules/skills/skill.effects';
import { upgradeSkill } from '../src/modules/skills/skill.service';
import { discoveryChance } from '../src/modules/information/information.generator';
import { resolveDistrict } from '@skyggeby/shared';
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

async function setSkill(playerId: string, skillId: SkillId, level: number) {
  await prisma.playerSkill.upsert({
    where: { playerId_skillId: { playerId, skillId } },
    create: { playerId, skillId, level },
    update: { level },
  });
}

async function skillLevels(playerId: string): Promise<Record<string, number>> {
  const rows = await prisma.playerSkill.findMany({ where: { playerId } });
  return Object.fromEntries(rows.map((r) => [r.skillId, r.level]));
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1-2. Ny spiller: seks ferdigheter på nivå 0, ingen poeng');

    {
      const username = `${(await import('./harness')).TEST_PREFIX}_sk`;
      const res = await post(server.base, '/auth/registrer', {
        body: { username, password: 'hemmelig123', confirmPassword: 'hemmelig123' },
      });
      check('registrering lykkes', res.status === 201,
        `${res.status} ${res.body?.error?.message ?? ''}`);

      const player = await prisma.player.findUniqueOrThrow({
        where: { usernameLower: username.toLowerCase() },
      });
      const rows = await prisma.playerSkill.findMany({ where: { playerId: player.id } });

      check('seks ferdigheter opprettet', rows.length === 6, `${rows.length}`);
      check('alle er nivå 0', rows.every((r) => r.level === 0));
      check(
        'alle katalogens id-er finnes',
        SKILL_IDS.every((id) => rows.some((r) => r.skillId === id)),
        rows.map((r) => r.skillId).join(','),
      );
      check('nye spillere har 0 ferdighetspoeng', player.skillPoints === 0,
        String(player.skillPoints));
      check('nivå 1 gir 0 poeng i kurven', totalSkillPointsForLevel(1) === 0);

      const listed = await get(server.base, '/ferdigheter', {
        cookie: `skyggeby_sid=${(await prisma.session.findFirstOrThrow({ where: { playerId: player.id } })).token}`,
      });
      check('API returnerer seks ferdigheter', listed.body?.skills?.length === 6);
      check('API returnerer poengsaldo', listed.body?.skillPoints === 0);
    }

    /* ================================================================== */
    section('3-6. Poengkurven per nivå');

    {
      check('1 -> 2 gir 2 poeng', skillPointsForLevelUp(1, 2) === 2);
      check('9 -> 10 gir 2 poeng', skillPointsForLevelUp(9, 10) === 2);
      check('10 -> 11 gir 1 poeng', skillPointsForLevelUp(10, 11) === 1);
      check('19 -> 20 gir 1 poeng', skillPointsForLevelUp(19, 20) === 1);
      check('20 -> 21 gir 0 poeng', skillPointsForLevelUp(20, 21) === 0);
      check('24 -> 25 gir 0 poeng', skillPointsForLevelUp(24, 25) === 0);
      check('totalt ved nivå 10 er 18', totalSkillPointsForLevel(10) === 18);
      check('totalt ved nivå 20 er 28', totalSkillPointsForLevel(20) === 28);
      check('totalt ved nivå 40 er fortsatt 28', totalSkillPointsForLevel(40) === 28);
      check('flernivåhopp summeres', skillPointsForLevelUp(1, 5) === 8);

      const grant = grantXp(0, 1, xpRequiredForLevel(3));
      check('grantXp rapporterer poeng', grant.skillPointsGained === 4, `${grant.skillPointsGained}`);
      check('grantXp setter riktig nivå', grant.level === 3, `${grant.level}`);
      check('uten nivåstigning gis ingen poeng', grantXp(0, 1, 1).skillPointsGained === 0);
    }

    /* ================================================================== */
    section('3b. Level-up gir poeng atomisk med jobben');

    {
      // One XP short of level 2, so the next job is guaranteed to level up.
      const t = await createTestPlayer({
        energy: 100,
        xp: xpRequiredForLevel(2) - 1,
        level: 1,
        skillPoints: 0,
      });

      const result = await performCrime(t.player.id, 'lommetyveri');
      const after = await reload(t.player.id);

      note(`nivå ${after.level}, poeng ${after.skillPoints}`);
      check('spilleren gikk opp i nivå', after.level === 2, `${after.level}`);
      check('to poeng ble gitt', after.skillPoints === 2, `${after.skillPoints}`);
      check('utfallet rapporterer poengene', result.outcome.skillPointsGained === 2,
        String(result.outcome.skillPointsGained));
      check('poengene stemmer med kurven',
        after.skillPoints === totalSkillPointsForLevel(after.level));
    }

    /* ================================================================== */
    section('7-9. Oppgradering');

    {
      const t = await createTestPlayer({ skillPoints: 3 });

      const res = await post(server.base, '/ferdigheter/oppgrader', {
        cookie: t.cookie,
        body: { skillId: 'etterretning' },
      });

      check('oppgradering svarer 200', res.status === 200, String(res.status));
      check('meldingen er norsk', res.body?.message === 'Etterretning er nå nivå 1.',
        res.body?.message);

      const after = await reload(t.player.id);
      check('nøyaktig ett poeng brukt', after.skillPoints === 2, `${after.skillPoints}`);
      check('ferdigheten er nivå 1', (await skillLevels(t.player.id)).etterretning === 1);
      check('andre ferdigheter er urørt',
        (await skillLevels(t.player.id)).kriminalitet === 0);
      check('svaret oppgir ny saldo', res.body?.skillPoints === 2);

      // Without points.
      const broke = await createTestPlayer({ skillPoints: 0 });
      const denied = await post(server.base, '/ferdigheter/oppgrader', {
        cookie: broke.cookie,
        body: { skillId: 'kriminalitet' },
      });
      check('uten poeng avvises', denied.status === 400, String(denied.status));
      check('feilkoden er riktig', denied.body?.error?.code === 'INGEN_FERDIGHETSPOENG',
        denied.body?.error?.code);
      check('feilmeldingen er norsk',
        denied.body?.error?.message === 'Du har ingen ferdighetspoeng å bruke.',
        denied.body?.error?.message);
      check('ingenting ble endret', (await reload(broke.player.id)).skillPoints === 0);

      // At the ceiling.
      const maxed = await createTestPlayer({ skillPoints: 5 });
      await setSkill(maxed.player.id, 'kriminalitet', SKILL_TUNING.maxLevel);
      const atMax = await post(server.base, '/ferdigheter/oppgrader', {
        cookie: maxed.cookie,
        body: { skillId: 'kriminalitet' },
      });
      check('maks nivå avvises', atMax.status === 400, String(atMax.status));
      check('feilkoden er MAKS_NIVA', atMax.body?.error?.code === 'MAKS_NIVA',
        atMax.body?.error?.code);
      check('poeng ble ikke trukket', (await reload(maxed.player.id)).skillPoints === 5);
      check('nivået står stille',
        (await skillLevels(maxed.player.id)).kriminalitet === SKILL_TUNING.maxLevel);

      // The database refuses a level past the ceiling no matter who writes it.
      const overflow = await settle(() =>
        setSkill(maxed.player.id, 'sosial', SKILL_TUNING.maxLevel + 1),
      );
      check('databasen avviser nivå 26', !overflow.ok, 'ble godtatt');
    }

    /* ================================================================== */
    section('10-11. Ugyldig og manipulert input');

    {
      const t = await createTestPlayer({ skillPoints: 5 });

      const cases: Array<{ label: string; body: unknown }> = [
        { label: 'ukjent ferdighet', body: { skillId: 'trolldom' } },
        { label: 'tom streng', body: { skillId: '' } },
        { label: 'tall', body: { skillId: 7 } },
        { label: 'manglende felt', body: {} },
        { label: 'null', body: { skillId: null } },
        { label: 'feil skrivemåte', body: { skillId: 'Etterretning' } },
      ];

      const results = await Promise.all(
        cases.map((c) =>
          post(server.base, '/ferdigheter/oppgrader', { cookie: t.cookie, body: c.body }),
        ),
      );
      results.forEach((res, i) => {
        check(`avvist: ${cases[i]!.label}`, res.status === 400, String(res.status));
      });
      check(
        'feilmeldingene er norske',
        results.every((r) => /ferdighet|påkrevd|tekst|Feltet/i.test(r.body?.error?.message ?? '')),
        results.map((r) => r.body?.error?.message).join(' | '),
      );
      check('ingen poeng brukt på avviste kall',
        (await reload(t.player.id)).skillPoints === 5);

      // Everything except skillId is outside the schema and never read.
      const forged = await post(server.base, '/ferdigheter/oppgrader', {
        cookie: t.cookie,
        body: {
          skillId: 'etterretning',
          level: 25,
          skillPoints: 999,
          bonus: 100,
          xp: 1_000_000,
          playerLevel: 99,
          effect: { crimeSuccessPoints: 100 },
          progress: 1,
        },
      });
      check('forfalsket forespørsel behandles normalt', forged.status === 200,
        String(forged.status));

      const after = await reload(t.player.id);
      const levels = await skillLevels(t.player.id);
      check('nivået økte med nøyaktig 1', levels.etterretning === 1, `${levels.etterretning}`);
      check('poengsaldoen ble ikke 999', after.skillPoints === 4, `${after.skillPoints}`);
      check('spillernivået er urørt', after.level === 1, `${after.level}`);
      check('XP er urørt', after.xp === 0, `${after.xp}`);
    }

    /* ================================================================== */
    section('12-13. Samtidige oppgraderinger');

    {
      // One point, two different skills, at the same time.
      const t = await createTestPlayer({ skillPoints: 1 });

      const [a, b] = await Promise.all([
        post(server.base, '/ferdigheter/oppgrader', {
          cookie: t.cookie,
          body: { skillId: 'etterretning' },
        }),
        post(server.base, '/ferdigheter/oppgrader', {
          cookie: t.cookie,
          body: { skillId: 'kriminalitet' },
        }),
      ]);

      const ok = [a, b].filter((r) => r.status === 200);
      note(`statuser: ${a.status}, ${b.status}`);

      check('nøyaktig én lykkes', ok.length === 1, `${ok.length}`);
      check('den andre avvises for manglende poeng',
        [a, b].some((r) => r.body?.error?.code === 'INGEN_FERDIGHETSPOENG'));

      const after = await reload(t.player.id);
      const levels = await skillLevels(t.player.id);
      check('poeng er brukt opp, ikke negativt', after.skillPoints === 0, `${after.skillPoints}`);
      const etterretning = levels.etterretning ?? 0;
      const kriminalitet = levels.kriminalitet ?? 0;
      check('nøyaktig ett nivå ble kjøpt',
        etterretning + kriminalitet === 1,
        `${etterretning}+${kriminalitet}`);

      // Twelve at once with three points.
      const t2 = await createTestPlayer({ skillPoints: 3 });
      const results = await burst(12, (i) =>
        settle(() => upgradeSkill(t2.player.id, SKILL_IDS[i % SKILL_IDS.length]!)),
      );

      const wins = results.filter((r) => r.ok).length;
      const denied = results.filter((r) => r.code === 'INGEN_FERDIGHETSPOENG').length;
      note(`ok=${wins} avvist=${denied}`);

      check('nøyaktig tre lykkes', wins === 3, `${wins}`);
      check('resten avvises rent', denied === 9, `${denied}`);

      const after2 = await reload(t2.player.id);
      const levels2 = await skillLevels(t2.player.id);
      const total = Object.values(levels2).reduce((sum, l) => sum + l, 0);
      check('poeng kan ikke bli negative', after2.skillPoints >= 0, `${after2.skillPoints}`);
      check('poeng er nøyaktig oppbrukt', after2.skillPoints === 0, `${after2.skillPoints}`);
      check('kjøpte nivåer tilsvarer brukte poeng', total === 3, `${total}`);
    }

    /* ================================================================== */
    section('14. Samtidig level-up og oppgradering');

    {
      const t = await createTestPlayer({
        energy: 100,
        xp: xpRequiredForLevel(2) - 1,
        level: 1,
        skillPoints: 1,
      });

      const [crime, upgrade] = await Promise.all([
        settle(() => performCrime(t.player.id, 'lommetyveri')),
        settle(() => upgradeSkill(t.player.id, 'etterretning')),
      ]);

      const after = await reload(t.player.id);
      const levels = await skillLevels(t.player.id);
      const spent = Object.values(levels).reduce((sum, l) => sum + l, 0);
      // The fixture handed out one point up front; the rest comes from the
      // level-up the crime caused.
      const granted = 1 + skillPointsForLevelUp(1, after.level);

      note(
        `nivå ${after.level}, poeng igjen ${after.skillPoints}, kjøpt ${spent}, tildelt ${granted}`,
      );

      check('begge operasjonene gikk gjennom', crime.ok && upgrade.ok,
        `${crime.code ?? 'ok'} / ${upgrade.code ?? 'ok'}`);
      check('poeng er aldri negative', after.skillPoints >= 0);
      check(
        'regnskapet går opp: tildelt = brukt + igjen',
        granted === spent + after.skillPoints,
        `${granted} vs ${spent}+${after.skillPoints}`,
      );
    }

    /* ================================================================== */
    section('15. Rollback ruller tilbake både nivå og poeng');

    {
      // A payout that breaches the wealth ceiling aborts the whole crime, XP,
      // level and skill points included.
      let sawRollback = false;

      for (let i = 0; i < 25 && !sawRollback; i += 1) {
        const t = await createTestPlayer({
          energy: 100,
          cash: 2_000_000_000,
          xp: xpRequiredForLevel(2) - 1,
          level: 1,
          skillPoints: 0,
        });

        const result = await settle(() => performCrime(t.player.id, 'lommetyveri'));
        if (!result.ok && result.code === 'TAK_NADD') {
          sawRollback = true;
          const after = await reload(t.player.id);
          check('XP er rullet tilbake', after.xp === xpRequiredForLevel(2) - 1, `${after.xp}`);
          check('nivået er rullet tilbake', after.level === 1, `${after.level}`);
          check('ferdighetspoengene er rullet tilbake', after.skillPoints === 0,
            `${after.skillPoints}`);
        }
      }

      check('klarte å framprovosere en avbrutt jobb', sawRollback);
    }

    /* ================================================================== */
    section('16-17. Etterretning og informasjon');

    {
      const district = resolveDistrict('sentrum');
      const none = getSkillEffects({});
      const maxed = getSkillEffects({ etterretning: SKILL_TUNING.maxLevel });

      note(
        `funnsjanse ${discoveryChance(district).toFixed(3)} -> ` +
          `${discoveryChance(district, maxed.informationDiscoveryChance).toFixed(3)}`,
      );

      check(
        'Etterretning øker funnsjansen',
        discoveryChance(district, maxed.informationDiscoveryChance) >
          discoveryChance(district, none.informationDiscoveryChance),
      );
      check(
        'funnsjansen respekterer taket',
        discoveryChance(district, 10) <= INFORMATION_TUNING.exploreMaxChance,
      );
      check('Etterretning gir pålitelighetsbonus', maxed.informationReliability > 0);
      check('nivå 0 gir ingenting', none.informationReliability === 0 &&
        none.informationDiscoveryChance === 0);

      // The information ceiling still holds with a maxed skill.
      const t = await createTestPlayer({ energy: 100, ...atLevel(18) });
      await setSkill(t.player.id, 'etterretning', SKILL_TUNING.maxLevel);
      await createInformation(t.player.id, {
        relevance: 'SIKKERHET',
        type: 'ETTERRETNING',
        reliability: 100,
        isTrue: true,
      });

      const result = await performCrime(t.player.id, 'innbrudd');
      const bonus = result.outcome.information?.bonusPoints ?? 0;
      const rawBonus = informationBonusPoints({
        type: 'ETTERRETNING',
        reliability: 100,
        freshness: 'FERSK',
      });

      note(`informasjonsbonus ${rawBonus} -> ${bonus} med maks Etterretning`);
      check('Etterretning forsterker informasjon', bonus >= rawBonus, `${bonus} vs ${rawBonus}`);
      check(
        'informasjonsbonusen overstiger aldri +15',
        bonus <= INFORMATION_TUNING.maxBonusPercentagePoints,
        `${bonus}`,
      );

      const attempt = await prisma.crimeAttempt.findFirstOrThrow({
        where: { playerId: t.player.id },
      });
      check('bokført bonus er innenfor taket',
        attempt.informationBonus <= INFORMATION_TUNING.maxBonusPercentagePoints * 10,
        String(attempt.informationBonus));
    }

    /* ================================================================== */
    section('18. Kriminalitet respekterer 95 %-taket');

    {
      const t = await createTestPlayer({ energy: 100, ...atLevel(18) });
      // Everything at once: max crime skill, max intel, perfect information, in
      // the quietest district in the city.
      await setSkill(t.player.id, 'kriminalitet', SKILL_TUNING.maxLevel);
      await setSkill(t.player.id, 'etterretning', SKILL_TUNING.maxLevel);
      await prisma.player.update({
        where: { id: t.player.id },
        data: { currentDistrictId: 'blokkene', heat: 0 },
      });
      await createInformation(t.player.id, {
        relevance: 'AKTIVITET',
        type: 'ETTERRETNING',
        reliability: 100,
        isTrue: true,
        districtId: 'blokkene',
      });

      await performCrime(t.player.id, 'lommetyveri');
      const attempt = await prisma.crimeAttempt.findFirstOrThrow({
        where: { playerId: t.player.id },
      });

      note(`sjanse med alt maksimert: ${attempt.chanceBps / 100} %`);
      check('sjansen når aldri over 95 %', attempt.chanceBps <= 9500, String(attempt.chanceBps));
      check('sjansen er fortsatt under 100 %', attempt.chanceBps < 10000);
    }

    /* ================================================================== */
    section('19-20. Nivå 0 og diminishing returns');

    {
      for (const skill of SKILLS) {
        const effect = getSkillEffect(skill.id, 0);
        const anyNonZero = Object.values(effect).some((v) => v !== 0);
        check(`${skill.name} på nivå 0 gir ingenting`, !anyNonZero);
      }

      check('kurven starter på 0', skillCurve(0) === 0);
      check('kurven ender på 1', skillCurve(SKILL_TUNING.maxLevel) === 1);

      const firstStep = skillCurve(1) - skillCurve(0);
      const lastStep = skillCurve(SKILL_TUNING.maxLevel) - skillCurve(SKILL_TUNING.maxLevel - 1);
      note(`første nivå gir ${(firstStep * 100).toFixed(1)} %, siste ${(lastStep * 100).toFixed(1)} %`);
      check('første nivå er verdt mer enn det siste', firstStep > lastStep * 5,
        `${firstStep} vs ${lastStep}`);

      let monotonic = true;
      let diminishing = true;
      let previousStep = Infinity;
      for (let level = 1; level <= SKILL_TUNING.maxLevel; level += 1) {
        const step = skillCurve(level) - skillCurve(level - 1);
        if (skillCurve(level) < skillCurve(level - 1)) monotonic = false;
        if (step > previousStep + 1e-9) diminishing = false;
        previousStep = step;
      }
      check('kurven er alltid stigende', monotonic);
      check('hvert nivå gir mindre enn det forrige', diminishing);

      // No effect can ever exceed its cap, whatever level is stored.
      const absurd = getSkillEffect('kriminalitet', 9999);
      check('effekten er klampet til taket', absurd.crimeSuccessPoints <= 6,
        String(absurd.crimeSuccessPoints));
      check('negativt nivå gir ingenting',
        getSkillEffect('kriminalitet', -50).crimeSuccessPoints === 0);
    }

    /* ================================================================== */
    section('21. API-et lekker ikke intern logikk');

    {
      const t = await createTestPlayer({ skillPoints: 2 });
      await setSkill(t.player.id, 'kriminalitet', 5);

      const res = await get(server.base, '/ferdigheter', { cookie: t.cookie });
      const raw = JSON.stringify(res.body);

      check('svaret er 200', res.status === 200, String(res.status));
      check('formelen lekker ikke', !/curveDecay|crimeSuccessPoints|SKILL_EFFECT_CAPS/.test(raw));
      check('interne tak lekker ikke', !/informationBonusBoost|damageReduction/.test(raw));

      const skill = res.body.skills.find((s: any) => s.id === 'kriminalitet');
      check('nivået vises', skill?.level === 5);
      check('effekten er en ferdig norsk setning',
        typeof skill?.currentEffect === 'string' && /prosentpoeng/.test(skill.currentEffect),
        skill?.currentEffect);
      check('neste nivå beskrives', typeof skill?.nextEffect === 'string');
      check('framdrift er 0..1', skill?.progress > 0 && skill?.progress < 1, String(skill?.progress));

      const anon = await get(server.base, '/ferdigheter');
      const anonPost = await post(server.base, '/ferdigheter/oppgrader', {
        body: { skillId: 'etterretning' },
      });
      check('uten sesjon gir 401 på liste', anon.status === 401, String(anon.status));
      check('uten sesjon gir 401 på oppgradering', anonPost.status === 401,
        String(anonPost.status));

      // One player's skills are not another's.
      const other = await createTestPlayer({ skillPoints: 0 });
      const otherList = await get(server.base, '/ferdigheter', { cookie: other.cookie });
      check('andre spillere ser sine egne nivåer',
        otherList.body.skills.every((s: any) => s.level === 0));
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
