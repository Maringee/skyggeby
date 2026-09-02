/**
 * Integration tests against the real PostgreSQL database.
 *
 * Focus: row locking and transaction isolation under genuine concurrency.
 * Run with `npm -w @skyggeby/server run test:db`.
 */
import { LIMITS, levelFromXp } from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { deposit, withdraw } from '../src/modules/economy/bank.service';
import { performCrime } from '../src/modules/crime/crime.service';
import { AppError } from '../src/lib/errors';
import {
  atLevel,
  burst,
  check,
  cleanup,
  createTestPlayer,
  get,
  note,
  purgeStaleTestData,
  post,
  reload,
  section,
  startServer,
  summary,
} from './harness';

interface Settled<T> {
  ok: boolean;
  value?: T;
  code?: string;
}

/** Runs a promise and captures the AppError code instead of throwing. */
async function settle<T>(fn: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof AppError ? error.code : `UVENTET:${String(error)}`,
    };
  }
}

async function ledgerTotals(playerId: string) {
  const rows = await prisma.transaction.findMany({ where: { playerId } });
  let cash = 0;
  let bank = 0;
  for (const row of rows) {
    if (row.ledger === 'CASH') cash += row.amount;
    else bank += row.amount;
  }
  return { cash, bank, count: rows.length };
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== *
     * 1. Samtidige kriminalitetsforespørsler
     * ================================================================== */
    section('1a. To samtidige kriminalitetsforespørsler over HTTP');

    {
      const t = await createTestPlayer({ cash: 0, energy: 100, heat: 0, xp: 0, level: 1 });

      const [a, b] = await Promise.all([
        post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie }),
        post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie }),
      ]);

      const oks = [a, b].filter((r) => r.status === 200);
      const blocked = [a, b].filter((r) => r.status === 429);

      note(`statuser: ${a.status}, ${b.status}`);
      check('nøyaktig én forespørsel lykkes', oks.length === 1, `${oks.length} fikk 200`);
      check('den andre blokkeres av avkjøling', blocked.length === 1);
      check(
        'blokkeringen er avkjøling, ikke en tilfeldig feil',
        blocked[0]?.body?.error?.code === 'AVKJOLING_AKTIV',
        blocked[0]?.body?.error?.code,
      );

      const attempts = await prisma.crimeAttempt.count({ where: { playerId: t.player.id } });
      check('kun ett forsøk er bokført', attempts === 1, `${attempts} rader`);

      const after = await reload(t.player.id);
      const outcome = oks[0]!.body.outcome;

      check('energi trukket nøyaktig én gang', after.energy === 98, `energi=${after.energy}`);
      check('XP tilsvarer det ene utfallet', after.xp === outcome.xpGained, `xp=${after.xp}`);
      check(
        'kontanter tilsvarer det ene utbyttet',
        after.cash === outcome.payout - outcome.fine,
        `cash=${after.cash} utbytte=${outcome.payout} bot=${outcome.fine}`,
      );
      check('heat tilsvarer det ene utfallet', after.heat === outcome.heatChange, `heat=${after.heat}`);
      check(
        'helse tilsvarer det ene utfallet',
        after.health === 100 + outcome.healthChange,
        `helse=${after.health}`,
      );

      const ledger = await ledgerTotals(t.player.id);
      check('bokføringen stemmer med saldoen', ledger.cash === after.cash, `logg=${ledger.cash}`);
    }

    section('1b. Tolv samtidige forsøk på samme kriminalitet');

    {
      const t = await createTestPlayer({ cash: 0, energy: 100, heat: 0, xp: 0 });

      const results = await burst(12, () => settle(() => performCrime(t.player.id, 'lommetyveri')));
      const ok = results.filter((r) => r.ok);
      const cooldown = results.filter((r) => r.code === 'AVKJOLING_AKTIV');
      const other = results.filter((r) => !r.ok && r.code !== 'AVKJOLING_AKTIV');

      note(`ok=${ok.length} avkjøling=${cooldown.length} andre=${other.length}`);
      if (other.length > 0) note(`andre koder: ${other.map((r) => r.code).join(', ')}`);

      check('kun én av tolv belønnes', ok.length === 1, `${ok.length} lyktes`);
      check('resten avvises av avkjøling', cooldown.length === 11);
      check('ingen uventede feil under press', other.length === 0);

      const after = await reload(t.player.id);
      check('energi trukket kun én gang', after.energy === 98, `energi=${after.energy}`);

      const attempts = await prisma.crimeAttempt.count({ where: { playerId: t.player.id } });
      check('kun ett forsøk bokført', attempts === 1, `${attempts} rader`);

      const ledger = await ledgerTotals(t.player.id);
      check('pengelogg = saldo', ledger.cash === after.cash, `logg=${ledger.cash} saldo=${after.cash}`);
    }

    section('1c. Avkjøling håndheves også sekvensielt');

    {
      const t = await createTestPlayer({ energy: 100 });
      const first = await settle(() => performCrime(t.player.id, 'lommetyveri'));
      const second = await settle(() => performCrime(t.player.id, 'lommetyveri'));

      check('første forsøk går gjennom', first.ok);
      check('andre forsøk blokkeres', second.code === 'AVKJOLING_AKTIV', second.code);

      // A different crime the player has unlocked is unaffected by that cooldown.
      const t2 = await createTestPlayer({ energy: 100, ...atLevel(3) });
      await performCrime(t2.player.id, 'lommetyveri');
      const otherCrime = await settle(() => performCrime(t2.player.id, 'butikktyveri'));
      check('avkjøling gjelder kun samme kriminalitet', otherCrime.ok, otherCrime.code);
    }

    section('1d. Energi kan ikke bli negativ under samtidige ulike kriminaliteter');

    {
      // Level 18 unlocks everything. Total energy cost of all five is 37.
      const t = await createTestPlayer({ ...atLevel(18), energy: 12, health: 100 });

      const ids = ['lommetyveri', 'butikktyveri', 'innbrudd', 'bilkapring', 'lagerinnbrudd'];
      const results = await burst(ids.length, (i) =>
        settle(() => performCrime(t.player.id, ids[i]!)),
      );

      const ok = results.filter((r) => r.ok);
      const spent = ok.reduce((sum, r) => sum + (r.value?.outcome.energySpent ?? 0), 0);

      const after = await reload(t.player.id);
      note(`lyktes=${ok.length} brukt energi=${spent} igjen=${after.energy}`);

      check('energi er aldri negativ', after.energy >= 0, `energi=${after.energy}`);
      check('forbruket overstiger ikke startenergien', spent <= 12, `brukt=${spent}`);
      check('energiregnskapet går opp', after.energy === 12 - spent, `${after.energy} != ${12 - spent}`);
      check(
        'avviste forsøk skyldes energimangel',
        results.filter((r) => !r.ok).every((r) => r.code === 'FOR_LITE_ENERGI'),
        results.filter((r) => !r.ok).map((r) => r.code).join(','),
      );

      const attempts = await prisma.crimeAttempt.count({ where: { playerId: t.player.id } });
      check('kun vellykkede forsøk bokføres', attempts === ok.length, `${attempts} vs ${ok.length}`);
    }

    /* ================================================================== *
     * 2. Samtidige bankoperasjoner
     * ================================================================== */
    section('2a. Ti samtidige innskudd som til sammen overstiger saldoen');

    {
      const t = await createTestPlayer({ cash: 1000, bankBalance: 0 });

      const results = await burst(10, () => settle(() => deposit(t.player.id, 200)));
      const ok = results.filter((r) => r.ok).length;
      const denied = results.filter((r) => r.code === 'IKKE_NOK_MIDLER').length;

      const after = await reload(t.player.id);
      note(`ok=${ok} avvist=${denied} cash=${after.cash} bank=${after.bankBalance}`);

      check('nøyaktig fem innskudd lykkes', ok === 5, `${ok} lyktes`);
      check('resten avvises for lite midler', denied === 5, `${denied} avvist`);
      check('kontanter går aldri under null', after.cash >= 0 && after.cash === 0, `cash=${after.cash}`);
      check('pengene er bevart', after.cash + after.bankBalance === 1000, `sum=${after.cash + after.bankBalance}`);

      const ledger = await ledgerTotals(t.player.id);
      check('kontantlogg stemmer', ledger.cash === after.cash - 1000, `logg=${ledger.cash}`);
      check('banklogg stemmer', ledger.bank === after.bankBalance, `logg=${ledger.bank}`);
      check('to rader per innskudd', ledger.count === ok * 2, `${ledger.count} rader`);
    }

    section('2b. Ti samtidige uttak fra samme konto');

    {
      const t = await createTestPlayer({ cash: 0, bankBalance: 1000 });

      const results = await burst(10, () => settle(() => withdraw(t.player.id, 200)));
      const ok = results.filter((r) => r.ok).length;

      const after = await reload(t.player.id);
      note(`ok=${ok} cash=${after.cash} bank=${after.bankBalance}`);

      check('nøyaktig fem uttak lykkes', ok === 5, `${ok} lyktes`);
      check('banksaldo går aldri under null', after.bankBalance >= 0, `bank=${after.bankBalance}`);
      check('banksaldoen er tømt', after.bankBalance === 0);
      // 200 out, 4 kr fee each -> 196 in hand per withdrawal.
      check('kontanter = uttak minus gebyr', after.cash === ok * 196, `cash=${after.cash}`);
      check(
        'samme penger kan ikke brukes to ganger',
        after.cash + after.bankBalance + ok * 4 === 1000,
        `sum=${after.cash + after.bankBalance + ok * 4}`,
      );

      const ledger = await ledgerTotals(t.player.id);
      check('kontantlogg stemmer', ledger.cash === after.cash, `logg=${ledger.cash}`);
      check('banklogg stemmer', ledger.bank === after.bankBalance - 1000, `logg=${ledger.bank}`);
      check('tre rader per uttak', ledger.count === ok * 3, `${ledger.count} rader`);
    }

    section('2c. Blandet innskudd og uttak samtidig');

    {
      const t = await createTestPlayer({ cash: 500, bankBalance: 500 });

      await burst(20, (i) =>
        settle(() => (i % 2 === 0 ? deposit(t.player.id, 100) : withdraw(t.player.id, 100))),
      );

      const after = await reload(t.player.id);
      const ledger = await ledgerTotals(t.player.id);

      note(`cash=${after.cash} bank=${after.bankBalance}`);
      check('ingen negativ kontantsaldo', after.cash >= 0, `cash=${after.cash}`);
      check('ingen negativ banksaldo', after.bankBalance >= 0, `bank=${after.bankBalance}`);
      check('kontantlogg = endring i kontanter', ledger.cash === after.cash - 500, `logg=${ledger.cash}`);
      check('banklogg = endring i bank', ledger.bank === after.bankBalance - 500, `logg=${ledger.bank}`);
      check(
        'formuen kan aldri vokse av seg selv',
        after.cash + after.bankBalance <= 1000,
        `sum=${after.cash + after.bankBalance}`,
      );

      // Every row's balanceAfter must be a non-negative, plausible balance.
      const rows = await prisma.transaction.findMany({
        where: { playerId: t.player.id },
        orderBy: { createdAt: 'asc' },
      });
      check('ingen bokført saldo er negativ', rows.every((r) => r.balanceAfter >= 0));
    }

    /* ================================================================== *
     * 3. Manipulerte klientdata
     * ================================================================== */
    section('3. Samtidige forespørsler med forfalskede klientverdier');

    {
      const t = await createTestPlayer({
        cash: 1000,
        bankBalance: 0,
        energy: 100,
        level: 1,
        xp: 0,
        health: 100,
        heat: 0,
      });

      const forged = {
        amount: 100,
        cash: 999_999_999,
        bankBalance: 999_999_999,
        energy: 9999,
        maxEnergy: 9999,
        level: 99,
        xp: 1_000_000,
        health: 999,
        heat: 0,
        reputation: 500_000,
        id: 'annen-spiller',
        playerId: 'annen-spiller',
      };

      const [dep, crime] = await Promise.all([
        post(server.base, '/spiller/bank/innskudd', { cookie: t.cookie, body: forged }),
        post(server.base, '/kriminalitet/lommetyveri', { cookie: t.cookie, body: forged }),
      ]);

      check('innskuddet behandles normalt', dep.status === 200, String(dep.status));
      check('kriminaliteten behandles normalt', crime.status === 200, String(crime.status));

      const after = await reload(t.player.id);
      const outcome = crime.body.outcome;

      check('klientens cash ignoreres', after.cash !== 999_999_999, `cash=${after.cash}`);
      check('klientens level ignoreres', after.level === 1, `level=${after.level}`);
      check('klientens xp ignoreres', after.xp === outcome.xpGained, `xp=${after.xp}`);
      check('klientens energy ignoreres', after.energy === 98, `energi=${after.energy}`);
      check('klientens maxEnergy ignoreres', after.maxEnergy === 100, `max=${after.maxEnergy}`);
      check('klientens health ignoreres', after.health <= 100, `helse=${after.health}`);
      check('klientens reputation ignoreres', after.reputation === 0, `respekt=${after.reputation}`);
      check(
        'kun beløpet ble brukt fra klienten',
        after.bankBalance === 100,
        `bank=${after.bankBalance}`,
      );
      check(
        'kontanter = 1000 - 100 innskudd + utfall',
        after.cash === 1000 - 100 + outcome.payout - outcome.fine,
        `cash=${after.cash}`,
      );

      // Ugyldige beløp
      const bad = await Promise.all([
        post(server.base, '/spiller/bank/innskudd', { cookie: t.cookie, body: { amount: -500 } }),
        post(server.base, '/spiller/bank/innskudd', { cookie: t.cookie, body: { amount: 10.5 } }),
        post(server.base, '/spiller/bank/innskudd', { cookie: t.cookie, body: { amount: '500' } }),
        post(server.base, '/spiller/bank/innskudd', {
          cookie: t.cookie,
          body: { amount: LIMITS.maxMoney + 1 },
        }),
        post(server.base, '/spiller/bank/innskudd', { cookie: t.cookie, body: {} }),
      ]);
      check('alle ugyldige beløp avvises med 400', bad.every((r) => r.status === 400),
        bad.map((r) => r.status).join(','));
      check('feilmeldingene er norske', bad.every((r) => typeof r.body?.error?.message === 'string'
        && /[æøåÆØÅ]|beløp|Beløp|tall/.test(r.body.error.message)),
        bad.map((r) => r.body?.error?.message).join(' | '));

      const untouched = await reload(t.player.id);
      check(
        'avviste forespørsler endret ingenting',
        untouched.cash === after.cash && untouched.bankBalance === after.bankBalance,
      );

      // En annen spillers ID i body gir ingen tilgang til den kontoen.
      const victim = await createTestPlayer({ cash: 5000 });
      await post(server.base, '/spiller/bank/innskudd', {
        cookie: t.cookie,
        body: { amount: 50, playerId: victim.player.id, id: victim.player.id },
      });
      const victimAfter = await reload(victim.player.id);
      check('en annen spillers konto er urørt', victimAfter.cash === 5000, `cash=${victimAfter.cash}`);

      // Uten gyldig sesjon skjer ingenting.
      const anon = await post(server.base, '/spiller/bank/innskudd', { body: { amount: 100 } });
      check('uten sesjon gir 401', anon.status === 401, String(anon.status));
    }

    /* ================================================================== *
     * 4. Rollback midt i en økonomisk operasjon
     * ================================================================== */
    section('4. Rollback når en operasjon feiler etter delvis bokføring');

    {
      // A withdrawal books three rows in order: bank out, cash in, fee.
      // With cash just under the ceiling the second row overflows, so the
      // first row is already written when the transaction aborts.
      const t = await createTestPlayer({
        cash: LIMITS.maxMoney - 10,
        bankBalance: 1000,
      });

      const before = await reload(t.player.id);
      const result = await settle(() => withdraw(t.player.id, 1000));

      check('operasjonen avvises', !result.ok, 'den lyktes uventet');
      check('feilkoden er taket, ikke en generisk feil', result.code === 'TAK_NADD', result.code);

      const after = await reload(t.player.id);
      check('banksaldo er rullet tilbake', after.bankBalance === before.bankBalance,
        `bank=${after.bankBalance} (var ${before.bankBalance})`);
      check('kontanter er uendret', after.cash === before.cash, `cash=${after.cash}`);

      const ledger = await ledgerTotals(t.player.id);
      check('ingen transaksjonsrader ble liggende igjen', ledger.count === 0, `${ledger.count} rader`);
    }

    section('4b. Rollback av passiv regenerering når handlingen avvises');

    {
      // Vitals are settled inside the transaction before eligibility is judged.
      // A rejected action must roll that write back too.
      const stale = new Date(Date.now() - 10 * 60 * 1000);
      const t = await createTestPlayer({
        energy: 1,
        heat: 40,
        energyUpdatedAt: stale,
        heatUpdatedAt: stale,
        ...atLevel(1),
      });

      const before = await reload(t.player.id);
      // Rejected on the level gate, which is checked after the vitals write.
      const result = await settle(() => performCrime(t.player.id, 'lagerinnbrudd'));
      check('forsøket avvises', !result.ok, 'lyktes uventet');
      check('avvist på nivåkravet', result.code === 'FOR_LAVT_NIVA', result.code);

      const after = await reload(t.player.id);
      check(
        'avvist handling ruller tilbake regenereringen',
        after.energy === before.energy && after.heat === before.heat,
        `energi ${before.energy}->${after.energy}, heat ${before.heat}->${after.heat}`,
      );
      check(
        'tidsstemplene er uendret',
        after.energyUpdatedAt.getTime() === before.energyUpdatedAt.getTime(),
      );

      const attempts = await prisma.crimeAttempt.count({ where: { playerId: t.player.id } });
      check('ingen forsøk bokført ved avvisning', attempts === 0, `${attempts} rader`);
    }

    section('4c. Regenerering går ikke tapt av en rollback');

    {
      const stale = new Date(Date.now() - 10 * 60 * 1000);
      const t = await createTestPlayer({ energy: 5, energyUpdatedAt: stale, level: 1 });

      // Rejected: level 12 required.
      await settle(() => performCrime(t.player.id, 'bilkapring'));
      // Accepted: the same regen is recomputed from the untouched timestamp.
      const ok = await settle(() => performCrime(t.player.id, 'lommetyveri'));

      check('handlingen lykkes etterpå', ok.ok, ok.code);
      const after = await reload(t.player.id);
      // 5 + 30 regenerated, capped at 100, minus 2 spent.
      check('regenereringen ble bevart', after.energy === 33, `energi=${after.energy}`);
    }

    section('4d. Nivå følger alltid av XP, også under samtidighet');

    {
      const t = await createTestPlayer({ energy: 100, ...atLevel(3) });
      const before = await reload(t.player.id);

      const results = await burst(6, () => settle(() => performCrime(t.player.id, 'butikktyveri')));
      const ok = results.filter((r) => r.ok);
      check('kun ett av seks forsøk teller', ok.length === 1, `${ok.length} lyktes`);

      const after = await reload(t.player.id);
      const gained = ok[0]!.value!.outcome.xpGained;
      check('XP økte nøyaktig én gang', after.xp === before.xp + gained, `xp=${after.xp}`);
      check(
        'nivået samsvarer med XP',
        after.level === levelFromXp(after.xp),
        `nivå=${after.level} forventet=${levelFromXp(after.xp)}`,
      );
    }

    section('5. Konsistens etter alt presset');

    {
      const players = await prisma.player.findMany({
        where: { username: { startsWith: (await import('./harness')).TEST_PREFIX } },
      });

      let allConsistent = true;
      const problems: string[] = [];

      for (const p of players) {
        if (p.cash < 0 || p.bankBalance < 0 || p.energy < 0 || p.health < 0 || p.heat < 0) {
          allConsistent = false;
          problems.push(`${p.username}: negativ verdi`);
        }
        if (p.energy > p.maxEnergy) {
          allConsistent = false;
          problems.push(`${p.username}: energi over taket`);
        }
        if (p.heat > LIMITS.maxHeat || p.health > LIMITS.maxHealth) {
          allConsistent = false;
          problems.push(`${p.username}: heat/helse over taket`);
        }
      }

      note(`kontrollerte ${players.length} spillere`);
      check('ingen spiller står i ugyldig tilstand', allConsistent, problems.join('; '));

      const orphaned = await prisma.transaction.count({
        where: { balanceAfter: { lt: 0 } },
      });
      check('ingen bokført negativ saldo i hele tabellen', orphaned === 0, `${orphaned} rader`);

      // Every real account must have a ledger that adds up to its balance.
      // Test fixtures are seeded straight into the row without a starting
      // transaction, so they are excluded - their deltas are checked per test.
      const realBalances = await prisma.$queryRaw<
        Array<{ username: string; cash: number; cash_ledger: bigint; bank: number; bank_ledger: bigint }>
      >`
        SELECT p.username,
               p.cash,
               COALESCE(SUM(t.amount) FILTER (WHERE t.ledger = 'CASH'), 0) AS cash_ledger,
               p."bankBalance" AS bank,
               COALESCE(SUM(t.amount) FILTER (WHERE t.ledger = 'BANK'), 0) AS bank_ledger
        FROM players p
        LEFT JOIN transactions t ON t."playerId" = p.id
        WHERE left(p.username, 3) <> 'qa_'
        GROUP BY p.id
      `;

      const mismatched = realBalances.filter(
        (row) => Number(row.cash_ledger) !== row.cash || Number(row.bank_ledger) !== row.bank,
      );
      note(`kontrollerte ${realBalances.length} ekte kontoer mot regnskapet`);
      check(
        'regnskapet stemmer for alle ekte kontoer',
        mismatched.length === 0,
        mismatched.map((r) => `${r.username}: ${r.cash} vs ${r.cash_ledger}`).join('; '),
      );

      const health = await get(server.base, '/helse');
      check('serveren er fortsatt frisk etterpå', health.status === 200);
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
