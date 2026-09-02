/**
 * Integration tests for the message system, against the real PostgreSQL
 * database and a real Express server.
 *
 * Nothing is mocked. Ownership, the conditional updates behind "mark as read"
 * and per-copy deletion are all exercised under genuine parallel load.
 *
 * Run with `npm -w @skyggeby/server run test:messages`.
 */
import { MESSAGE_LIMITS } from '@skyggeby/shared';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/errors';
import {
  deleteMessage,
  getMessage,
  listMessages,
  markAsRead,
  sendMessage,
  unreadCount,
} from '../src/modules/messages/message.service';
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

/** Sends one at a time, so ordering in the tests is deterministic. */
async function seedMessages(
  senderId: string,
  recipientId: string,
  count: number,
  prefix = 'Melding',
) {
  const ids: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const result = await sendMessage(
      senderId,
      recipientId,
      `${prefix} ${i}`,
      `Innhold nummer ${i}.`,
    );
    ids.push(result.message.id);
  }
  return ids;
}

async function row(messageId: string) {
  return prisma.message.findUniqueOrThrow({ where: { id: messageId } });
}

async function main() {
  const stale = await purgeStaleTestData();
  if (stale > 0) console.log(`(ryddet bort ${stale} rester fra en avbrutt kjøring)`);

  const server = await startServer();

  try {
    /* ================================================================== */
    section('1. Sending');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();

      const res = await post(server.base, '/meldinger/send', {
        cookie: a.cookie,
        body: {
          recipientId: b.player.id,
          subject: '  Møte i Havna  ',
          content: '  Kom alene. Ta med det du lovte.  ',
        },
      });

      check('sending svarer 201', res.status === 201, String(res.status));
      check(
        'bekreftelsen er norsk og navngir mottakeren',
        res.body?.message === `Meldingen ble sendt til ${b.player.username}.`,
        res.body?.message,
      );

      const sent = res.body?.sent;
      check('emnet ble trimmet', sent?.subject === 'Møte i Havna', sent?.subject);
      check(
        'innholdet ble trimmet',
        sent?.content === 'Kom alene. Ta med det du lovte.',
        sent?.content,
      );
      check('avsenderen er den innloggede', sent?.sender?.id === a.player.id);
      check('avsendernavnet følger med', sent?.sender?.username === a.player.username);
      check('mottakeren er riktig', sent?.recipient?.id === b.player.id);
      check('retningen er utgående for avsenderen', sent?.direction === 'UT', sent?.direction);
      check('meldingen starter ulest', sent?.read === false && sent?.readAt === null);
      check('tidspunktet er med', typeof sent?.createdAt === 'string');

      const stored = await prisma.message.findFirstOrThrow({
        where: { senderId: a.player.id, recipientId: b.player.id },
      });
      check('raden ble skrevet', stored.subject === 'Møte i Havna');
      check('den er ulest i databasen', stored.readAt === null);
      check('ingen av slettemerkene er satt',
        stored.senderDeletedAt === null && stored.recipientDeletedAt === null);
    }

    {
      const a = await createTestPlayer();

      const self = await post(server.base, '/meldinger/send', {
        cookie: a.cookie,
        body: { recipientId: a.player.id, subject: 'Til meg', content: 'Hei, meg.' },
      });
      check('melding til seg selv avvises', self.status === 400, String(self.status));
      check('feilkoden er egen', self.body?.error?.code === 'IKKE_TIL_DEG_SELV',
        self.body?.error?.code);
      check(
        'meldingen er norsk',
        /kan ikke sende melding til deg selv/.test(self.body?.error?.message ?? ''),
        self.body?.error?.message,
      );

      const unknown = await post(server.base, '/meldinger/send', {
        cookie: a.cookie,
        body: { recipientId: 'finnes-ikke', subject: 'Hallo', content: 'Er du der?' },
      });
      check('ukjent mottaker gir 404', unknown.status === 404, String(unknown.status));
      check(
        'meldingen er norsk',
        /Fant ikke spilleren/.test(unknown.body?.error?.message ?? ''),
        unknown.body?.error?.message,
      );

      check(
        'ingen rader ble skrevet av avviste forsøk',
        (await prisma.message.count({ where: { senderId: a.player.id } })) === 0,
      );
    }

    /* ================================================================== */
    section('2. Validering');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();

      const cases: Array<[string, unknown, RegExp]> = [
        ['tomt emne', { recipientId: b.player.id, subject: '', content: 'Hei' }, /emne/i],
        [
          'emne med bare mellomrom',
          { recipientId: b.player.id, subject: '     ', content: 'Hei' },
          /emne/i,
        ],
        [
          'tomt innhold',
          { recipientId: b.player.id, subject: 'Emne', content: '' },
          /tom/i,
        ],
        [
          'innhold med bare mellomrom',
          { recipientId: b.player.id, subject: 'Emne', content: '   \n\t  ' },
          /tom/i,
        ],
        ['manglende emne', { recipientId: b.player.id, content: 'Hei' }, /emne/i],
        ['manglende innhold', { recipientId: b.player.id, subject: 'Emne' }, /tom/i],
        ['manglende mottaker', { subject: 'Emne', content: 'Hei' }, /hvem/i],
        [
          'for langt emne',
          { recipientId: b.player.id, subject: 'x'.repeat(101), content: 'Hei' },
          /maks 100 tegn/,
        ],
        [
          'for langt innhold',
          {
            recipientId: b.player.id,
            subject: 'Emne',
            content: 'x'.repeat(MESSAGE_LIMITS.contentMax + 1),
          },
          /maks 5000 tegn/,
        ],
        [
          'mottaker-id som er absurd lang',
          { recipientId: 'x'.repeat(200), subject: 'Emne', content: 'Hei' },
          /mottaker/i,
        ],
      ];

      for (const [name, body, pattern] of cases) {
        const res = await post(server.base, '/meldinger/send', { cookie: a.cookie, body });
        check(`${name} avvises`, res.status === 400, String(res.status));
        check(
          `${name}: meldingen er norsk`,
          pattern.test(res.body?.error?.message ?? ''),
          res.body?.error?.message,
        );
      }

      check(
        'ingen ugyldige meldinger ble lagret',
        (await prisma.message.count({ where: { senderId: a.player.id } })) === 0,
      );

      // The boundaries themselves are legal.
      const edge = await post(server.base, '/meldinger/send', {
        cookie: a.cookie,
        body: {
          recipientId: b.player.id,
          subject: 'x'.repeat(MESSAGE_LIMITS.subjectMax),
          content: 'y'.repeat(MESSAGE_LIMITS.contentMax),
        },
      });
      check('nøyaktig 100 tegn emne godtas', edge.status === 201, String(edge.status));
      check(
        'nøyaktig 5000 tegn innhold lagres helt',
        edge.body?.sent?.content?.length === MESSAGE_LIMITS.contentMax,
        `${edge.body?.sent?.content?.length}`,
      );

      const minimal = await post(server.base, '/meldinger/send', {
        cookie: a.cookie,
        body: { recipientId: b.player.id, subject: 'A', content: 'B' },
      });
      check('ett tegn i hvert felt godtas', minimal.status === 201, String(minimal.status));
    }

    /* ================================================================== */
    section('3. Innboks og sendt');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const c = await createTestPlayer();

      const ids = await seedMessages(a.player.id, b.player.id, 30);
      await seedMessages(c.player.id, b.player.id, 2, 'Fra en annen');
      await seedMessages(b.player.id, c.player.id, 3, 'Utgående');

      const inbox = await get(server.base, '/meldinger', { cookie: b.cookie });
      check('innboksen svarer 200', inbox.status === 200, String(inbox.status));
      check('postkassen oppgis', inbox.body?.box === 'innboks', inbox.body?.box);
      check('standard sidestørrelse er 25', inbox.body?.messages?.length === 25,
        `${inbox.body?.messages?.length}`);
      check('det finnes en neste side', typeof inbox.body?.nextCursor === 'string');
      check('ulest-tallet følger med', inbox.body?.unread === 32, `${inbox.body?.unread}`);
      check(
        'nyeste melding først',
        inbox.body.messages[0].subject === 'Fra en annen 2',
        inbox.body.messages[0].subject,
      );
      check(
        'alle radene er innkommende',
        inbox.body.messages.every((m: any) => m.direction === 'INN'),
      );
      check(
        'alle radene har mottakeren som eier',
        inbox.body.messages.every((m: any) => m.recipient.id === b.player.id),
      );

      const page2 = await get(
        server.base,
        `/meldinger?cursor=${encodeURIComponent(inbox.body.nextCursor)}`,
        { cookie: b.cookie },
      );
      check('side to svarer 200', page2.status === 200);
      check('side to har resten', page2.body?.messages?.length === 7,
        `${page2.body?.messages?.length}`);
      check('siste side har ingen markør', page2.body?.nextCursor === null);

      const ids1 = new Set(inbox.body.messages.map((m: any) => m.id));
      check(
        'sidene overlapper ikke',
        page2.body.messages.every((m: any) => !ids1.has(m.id)),
      );
      check(
        'til sammen er alle 32 med',
        new Set([...ids1, ...page2.body.messages.map((m: any) => m.id)]).size === 32,
      );

      const limited = await get(server.base, '/meldinger?limit=5', { cookie: b.cookie });
      check('limit respekteres', limited.body?.messages?.length === 5,
        `${limited.body?.messages?.length}`);

      const tooBig = await get(server.base, '/meldinger?limit=100', { cookie: b.cookie });
      check('limit over 50 avvises', tooBig.status === 400, String(tooBig.status));
      check(
        'meldingen er norsk',
        /maks 50/.test(tooBig.body?.error?.message ?? ''),
        tooBig.body?.error?.message,
      );

      // The service clamps as well, so nothing that calls it directly can ask
      // for an unbounded page.
      const many = await createTestPlayer();
      await seedMessages(a.player.id, many.player.id, MESSAGE_LIMITS.maxPageSize + 5, 'Mengde');
      const clamped = await listMessages(many.player.id, 'innboks', { limit: 999 });
      check(
        'tjenesten klamper også selv',
        clamped.messages.length === MESSAGE_LIMITS.maxPageSize,
        `${clamped.messages.length}`,
      );
      check('og den har flere sider igjen', clamped.nextCursor !== null);

      const sent = await get(server.base, '/meldinger?boks=sendt', { cookie: b.cookie });
      check('sendt-boksen svarer 200', sent.status === 200);
      check('sendt-boksen oppgis', sent.body?.box === 'sendt');
      check('sendt-boksen har egne meldinger', sent.body?.messages?.length === 3,
        `${sent.body?.messages?.length}`);
      check(
        'alle radene er utgående',
        sent.body.messages.every((m: any) => m.direction === 'UT' && m.sender.id === b.player.id),
      );

      const unknownBox = await get(server.base, '/meldinger?boks=arkiv', { cookie: b.cookie });
      check('ukjent postkasse avvises', unknownBox.status === 400, String(unknownBox.status));

      const empty = await get(server.base, '/meldinger?boks=sendt', { cookie: a.cookie });
      check('avsenderens sendt-boks har 30', empty.body?.messages?.length === 25);
      const emptyInbox = await get(server.base, '/meldinger', { cookie: a.cookie });
      check('tom innboks er tom', emptyInbox.body?.messages?.length === 0);
      check('tom innboks har ingen uleste', emptyInbox.body?.unread === 0);

      // Listings ship a preview, never the whole body.
      check(
        'lista bærer ikke hele innholdet',
        inbox.body.messages.every((m: any) => m.content === undefined),
      );
      check(
        'lista bærer et forhåndsvisning',
        typeof inbox.body.messages[0].preview === 'string' &&
          inbox.body.messages[0].preview.length > 0,
      );

      const long = await sendMessage(a.player.id, b.player.id, 'Langt', 'z'.repeat(400));
      const withLong = await get(server.base, '/meldinger?limit=1', { cookie: b.cookie });
      check(
        'forhåndsvisningen kortes ned',
        withLong.body.messages[0].preview.length <= MESSAGE_LIMITS.previewLength + 1,
        `${withLong.body.messages[0].preview.length}`,
      );
      check(
        'forkortingen markeres',
        withLong.body.messages[0].preview.endsWith('…'),
        withLong.body.messages[0].preview.slice(-5),
      );
      await prisma.message.delete({ where: { id: long.message.id } });
      note(`${ids.length} meldinger seedet for pagineringen`);
    }

    /* ================================================================== */
    section('4. Enkeltmelding');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const c = await createTestPlayer();
      const [id] = await seedMessages(a.player.id, b.player.id, 1, 'Hemmelig');

      const asRecipient = await get(server.base, `/meldinger/${id}`, { cookie: b.cookie });
      check('mottakeren kan lese den', asRecipient.status === 200, String(asRecipient.status));
      check('hele innholdet følger med', asRecipient.body?.message?.content === 'Innhold nummer 1.');
      check('retningen er innkommende', asRecipient.body?.message?.direction === 'INN');

      const asSender = await get(server.base, `/meldinger/${id}`, { cookie: a.cookie });
      check('avsenderen kan lese den', asSender.status === 200, String(asSender.status));
      check('retningen er utgående for avsenderen', asSender.body?.message?.direction === 'UT');

      const asStranger = await get(server.base, `/meldinger/${id}`, { cookie: c.cookie });
      check('en tredjepart får 404', asStranger.status === 404, String(asStranger.status));
      check(
        'svaret lekker ingenting',
        !JSON.stringify(asStranger.body ?? {}).includes('Hemmelig'),
      );

      const missing = await get(server.base, '/meldinger/finnes-ikke', { cookie: b.cookie });
      check('ukjent melding gir 404', missing.status === 404, String(missing.status));
      check(
        'meldingen er norsk',
        /Fant ikke denne meldingen/.test(missing.body?.error?.message ?? ''),
        missing.body?.error?.message,
      );

      check(
        'å lese detaljen markerer den ikke lest av seg selv',
        (await row(id!)).readAt === null,
      );
    }

    /* ================================================================== */
    section('5. Uleste');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();

      const zero = await get(server.base, '/meldinger/uleste', { cookie: b.cookie });
      check('ulest-endepunktet svarer 200', zero.status === 200, String(zero.status));
      check('uten meldinger er tallet 0', zero.body?.count === 0, `${zero.body?.count}`);
      check(
        'svaret inneholder bare tallet',
        JSON.stringify(Object.keys(zero.body)) === JSON.stringify(['count']),
        Object.keys(zero.body).join(','),
      );

      const ids = await seedMessages(a.player.id, b.player.id, 3);
      const three = await get(server.base, '/meldinger/uleste', { cookie: b.cookie });
      check('tre uleste telles', three.body?.count === 3, `${three.body?.count}`);

      const senderSide = await get(server.base, '/meldinger/uleste', { cookie: a.cookie });
      check('avsenderen har ingen uleste av sine egne', senderSide.body?.count === 0);

      await markAsRead(b.player.id, ids[0]!);
      check('lest melding telles ikke', (await unreadCount(b.player.id)) === 2);

      await deleteMessage(b.player.id, ids[1]!);
      check('slettet melding telles ikke', (await unreadCount(b.player.id)) === 1);
    }

    /* ================================================================== */
    section('6. Markere som lest');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const c = await createTestPlayer();
      const [id] = await seedMessages(a.player.id, b.player.id, 1);

      const first = await post(server.base, `/meldinger/${id}/les`, { cookie: b.cookie });
      check('markering svarer 200', first.status === 200, String(first.status));
      check('meldingen er norsk', first.body?.message === 'Meldingen er markert som lest.',
        first.body?.message);
      check('DTO-en er lest', first.body?.read?.read === true);
      check('tidspunktet er satt', typeof first.body?.read?.readAt === 'string');
      check('ulest-tallet er oppdatert', first.body?.unread === 0, `${first.body?.unread}`);

      const stamp = (await row(id!)).readAt?.getTime();

      const again = await post(server.base, `/meldinger/${id}/les`, { cookie: b.cookie });
      check('ny markering svarer fortsatt 200', again.status === 200, String(again.status));
      check('den sier at den allerede var lest',
        again.body?.message === 'Meldingen var allerede lest.', again.body?.message);
      check('tidspunktet endres ikke', (await row(id!)).readAt?.getTime() === stamp);

      const bySender = await post(server.base, `/meldinger/${id}/les`, { cookie: a.cookie });
      check('avsenderen kan ikke markere den', bySender.status === 404, String(bySender.status));

      const [second] = await seedMessages(a.player.id, b.player.id, 1, 'Ny');
      const byStranger = await post(server.base, `/meldinger/${second}/les`, {
        cookie: c.cookie,
      });
      check('en tredjepart kan ikke markere den', byStranger.status === 404,
        String(byStranger.status));
      check('den er fortsatt ulest', (await row(second!)).readAt === null);

      const unknown = await post(server.base, '/meldinger/finnes-ikke/les', {
        cookie: b.cookie,
      });
      check('ukjent melding gir 404', unknown.status === 404, String(unknown.status));
    }

    /* ================================================================== */
    section('7. Sletting');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const [id] = await seedMessages(a.player.id, b.player.id, 1, 'Slettes');

      const byRecipient = await post(server.base, `/meldinger/${id}/slett`, {
        cookie: b.cookie,
      });
      check('mottakeren kan slette', byRecipient.status === 200, String(byRecipient.status));
      check('meldingen er norsk', byRecipient.body?.message === 'Meldingen er slettet.',
        byRecipient.body?.message);

      const stored = await row(id!);
      check('raden finnes fortsatt', stored !== null);
      check('mottakerens merke er satt', stored.recipientDeletedAt !== null);
      check('avsenderens merke er urørt', stored.senderDeletedAt === null);

      const inbox = await get(server.base, '/meldinger', { cookie: b.cookie });
      check('den er borte fra innboksen', inbox.body?.messages?.length === 0);
      const detail = await get(server.base, `/meldinger/${id}`, { cookie: b.cookie });
      check('mottakeren kan ikke åpne den lenger', detail.status === 404, String(detail.status));

      const senderSees = await get(server.base, '/meldinger?boks=sendt', { cookie: a.cookie });
      check('avsenderen ser fortsatt sin kopi', senderSees.body?.messages?.length === 1);
      const senderDetail = await get(server.base, `/meldinger/${id}`, { cookie: a.cookie });
      check('avsenderen kan fortsatt åpne den', senderDetail.status === 200);

      const twice = await post(server.base, `/meldinger/${id}/slett`, { cookie: b.cookie });
      check('sletting to ganger svarer 200', twice.status === 200, String(twice.status));
      check('den sier at den allerede var slettet',
        twice.body?.message === 'Meldingen var allerede slettet.', twice.body?.message);

      const bySender = await post(server.base, `/meldinger/${id}/slett`, { cookie: a.cookie });
      check('avsenderen kan slette sin egen kopi', bySender.status === 200);
      const both = await row(id!);
      check('begge merkene er satt',
        both.senderDeletedAt !== null && both.recipientDeletedAt !== null);
      check('raden er fortsatt i databasen', both.subject === 'Slettes 1');
      check(
        'ingen av dem ser den lenger',
        (await get(server.base, `/meldinger/${id}`, { cookie: a.cookie })).status === 404 &&
          (await get(server.base, `/meldinger/${id}`, { cookie: b.cookie })).status === 404,
      );
    }

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const c = await createTestPlayer();
      const [id] = await seedMessages(a.player.id, b.player.id, 1, 'Andres');

      const byStranger = await post(server.base, `/meldinger/${id}/slett`, {
        cookie: c.cookie,
      });
      check('en tredjepart kan ikke slette', byStranger.status === 404, String(byStranger.status));

      const untouched = await row(id!);
      check('ingen merker ble satt',
        untouched.senderDeletedAt === null && untouched.recipientDeletedAt === null);

      const unknown = await post(server.base, '/meldinger/finnes-ikke/slett', {
        cookie: b.cookie,
      });
      check('ukjent melding gir 404', unknown.status === 404, String(unknown.status));
    }

    /* ================================================================== */
    section('8. Sikkerhet');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const c = await createTestPlayer();

      // Every field the client should not control, in one request.
      const res = await post(server.base, '/meldinger/send', {
        cookie: a.cookie,
        body: {
          recipientId: b.player.id,
          subject: 'Manipulert',
          content: 'Innhold.',
          senderId: c.player.id,
          id: 'valgt-av-klienten',
          readAt: new Date().toISOString(),
          createdAt: '2020-01-01T00:00:00.000Z',
          senderDeletedAt: new Date().toISOString(),
          recipientDeletedAt: new Date().toISOString(),
          playerId: c.player.id,
        },
      });

      check('meldingen sendes', res.status === 201, String(res.status));

      const stored = await prisma.message.findFirstOrThrow({
        where: { subject: 'Manipulert' },
      });
      check('senderId fra klienten ignoreres', stored.senderId === a.player.id);
      check('id fra klienten ignoreres', stored.id !== 'valgt-av-klienten');
      check('readAt fra klienten ignoreres', stored.readAt === null);
      check('slettemerker fra klienten ignoreres',
        stored.senderDeletedAt === null && stored.recipientDeletedAt === null);
      check(
        'createdAt settes av serveren',
        stored.createdAt.getTime() > Date.parse('2024-01-01T00:00:00.000Z'),
        stored.createdAt.toISOString(),
      );
      check('den tredje spilleren fikk ingenting',
        (await prisma.message.count({ where: { recipientId: c.player.id } })) === 0);
      check('den tredje spilleren sendte ingenting',
        (await prisma.message.count({ where: { senderId: c.player.id } })) === 0);
    }

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const [id] = await seedMessages(a.player.id, b.player.id, 1, 'IDOR');

      // Everything an outsider could try with a known id.
      const intruder = await createTestPlayer();
      const attempts = [
        await get(server.base, `/meldinger/${id}`, { cookie: intruder.cookie }),
        await post(server.base, `/meldinger/${id}/les`, { cookie: intruder.cookie }),
        await post(server.base, `/meldinger/${id}/slett`, { cookie: intruder.cookie }),
      ];
      check('alle IDOR-forsøk gir 404', attempts.every((r) => r.status === 404),
        attempts.map((r) => r.status).join(','));
      check(
        'ingen av dem lekker emnet',
        attempts.every((r) => !JSON.stringify(r.body ?? {}).includes('IDOR')),
      );

      const after = await row(id!);
      check('meldingen er uendret', after.readAt === null &&
        after.senderDeletedAt === null && after.recipientDeletedAt === null);
      check(
        'inntrengeren ser ingenting i sin innboks',
        (await get(server.base, '/meldinger', { cookie: intruder.cookie })).body?.messages
          ?.length === 0,
      );
    }

    {
      // Nothing about a player leaks through a message.
      const a = await createTestPlayer({ cash: 999999 });
      const b = await createTestPlayer();
      const [id] = await seedMessages(a.player.id, b.player.id, 1, 'Lekkasje');

      const detail = await get(server.base, `/meldinger/${id}`, { cookie: b.cookie });
      const list = await get(server.base, '/meldinger', { cookie: b.cookie });
      const blob = JSON.stringify(detail.body) + JSON.stringify(list.body);

      for (const field of [
        'passwordHash',
        'usernameLower',
        'bankBalance',
        'currentDistrictId',
        'skillPoints',
        'heat',
        'energyUpdatedAt',
        '999999',
      ]) {
        check(`${field} lekker ikke`, !blob.includes(field));
      }

      check(
        'avsenderen serialiseres kun med id og navn',
        JSON.stringify(Object.keys(detail.body.message.sender).sort()) ===
          JSON.stringify(['id', 'username']),
        Object.keys(detail.body.message.sender).join(','),
      );
      check(
        'meldingen har nøyaktig de feltene den skal',
        JSON.stringify(Object.keys(detail.body.message).sort()) ===
          JSON.stringify([
            'content',
            'createdAt',
            'direction',
            'id',
            'preview',
            'read',
            'readAt',
            'recipient',
            'sender',
            'subject',
          ]),
        Object.keys(detail.body.message).join(','),
      );
      check(
        'interne slettefelter er ikke med',
        !blob.includes('senderDeletedAt') && !blob.includes('recipientDeletedAt'),
      );
    }

    {
      // Text that looks like an attack is text, and comes back byte for byte.
      const a = await createTestPlayer();
      const b = await createTestPlayer();

      const xss = '<script>alert("skyggeby")</script><img src=x onerror=alert(1)>';
      const sql = "Robert'); DROP TABLE messages;--";

      const res = await post(server.base, '/meldinger/send', {
        cookie: a.cookie,
        body: { recipientId: b.player.id, subject: sql, content: xss },
      });

      check('skadelig utseende tekst godtas som tekst', res.status === 201, String(res.status));
      check('innholdet returneres uendret', res.body?.sent?.content === xss,
        res.body?.sent?.content);
      check('emnet returneres uendret', res.body?.sent?.subject === sql);

      const stored = await prisma.message.findFirstOrThrow({
        where: { senderId: a.player.id },
      });
      check('teksten lagres uendret', stored.content === xss);
      check('ingenting ble tolket som HTML', stored.content.includes('<script>'));
      check(
        'meldingstabellen står fortsatt',
        (await prisma.message.count({ where: { senderId: a.player.id } })) === 1,
      );

      const fetched = await get(server.base, `/meldinger/${stored.id}`, { cookie: b.cookie });
      check('den leses tilbake uendret', fetched.body?.message?.content === xss);
    }

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const [id] = await seedMessages(a.player.id, b.player.id, 1);

      const paths: Array<[string, () => Promise<{ status: number }>]> = [
        ['lista', () => get(server.base, '/meldinger')],
        ['uleste', () => get(server.base, '/meldinger/uleste')],
        ['detaljen', () => get(server.base, `/meldinger/${id}`)],
        ['mottakersøket', () => get(server.base, '/meldinger/mottakere?sok=qa')],
        [
          'sending',
          () =>
            post(server.base, '/meldinger/send', {
              body: { recipientId: b.player.id, subject: 'Uten konto', content: 'Hei' },
            }),
        ],
        ['markering', () => post(server.base, `/meldinger/${id}/les`)],
        ['sletting', () => post(server.base, `/meldinger/${id}/slett`)],
      ];

      for (const [name, call] of paths) {
        const res = await call();
        check(`${name} krever innlogging`, res.status === 401, String(res.status));
      }

      check('ingenting ble endret av uautentiserte forsøk',
        (await row(id!)).readAt === null);
    }

    /* ================================================================== */
    section('9. Mottakersøk');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();

      const found = await get(
        server.base,
        `/meldinger/mottakere?sok=${encodeURIComponent(b.player.username)}`,
        { cookie: a.cookie },
      );
      check('søket svarer 200', found.status === 200, String(found.status));
      check('spilleren finnes', found.body?.players?.some((p: any) => p.id === b.player.id));
      check(
        'kun id og navn returneres',
        found.body.players.every(
          (p: any) => JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['id', 'username']),
        ),
      );
      check(
        'en selv er ikke med i treffene',
        !found.body.players.some((p: any) => p.id === a.player.id),
      );

      const short = await get(server.base, '/meldinger/mottakere?sok=q', { cookie: a.cookie });
      check('for kort søk avvises', short.status === 400, String(short.status));

      const none = await get(server.base, '/meldinger/mottakere?sok=zzzfinnesikke', {
        cookie: a.cookie,
      });
      check('uten treff er lista tom', none.body?.players?.length === 0);
    }

    /* ================================================================== */
    section('10. Databasens egne skranker');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();

      const blank = await settle(() =>
        prisma.message.create({
          data: { senderId: a.player.id, recipientId: b.player.id, subject: '   ', content: 'Hei' },
        }),
      );
      check('databasen nekter tomt emne', !blank.ok, 'lyktes uventet');

      const blankBody = await settle(() =>
        prisma.message.create({
          data: { senderId: a.player.id, recipientId: b.player.id, subject: 'Emne', content: ' ' },
        }),
      );
      check('databasen nekter tomt innhold', !blankBody.ok, 'lyktes uventet');

      const tooLong = await settle(() =>
        prisma.message.create({
          data: {
            senderId: a.player.id,
            recipientId: b.player.id,
            subject: 'Emne',
            content: 'x'.repeat(5001),
          },
        }),
      );
      check('databasen nekter for langt innhold', !tooLong.ok, 'lyktes uventet');

      const self = await settle(() =>
        prisma.message.create({
          data: { senderId: a.player.id, recipientId: a.player.id, subject: 'Meg', content: 'Meg' },
        }),
      );
      check('databasen nekter melding til seg selv', !self.ok, 'lyktes uventet');

      const ghost = await settle(() =>
        prisma.message.create({
          data: {
            senderId: a.player.id,
            recipientId: 'finnes-ikke',
            subject: 'Emne',
            content: 'Hei',
          },
        }),
      );
      check('databasen nekter ukjent mottaker', !ghost.ok, 'lyktes uventet');

      check(
        'ingen av de avviste radene ble skrevet',
        (await prisma.message.count({ where: { senderId: a.player.id } })) === 0,
      );
    }

    /* ================================================================== */
    section('11. Sletting av spiller');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      await seedMessages(a.player.id, b.player.id, 2);
      await seedMessages(b.player.id, a.player.id, 2);

      check('fire meldinger finnes',
        (await prisma.message.count({
          where: { OR: [{ senderId: a.player.id }, { recipientId: a.player.id }] },
        })) === 4);

      await prisma.player.delete({ where: { id: a.player.id } });

      check(
        'meldingene forsvinner med spilleren',
        (await prisma.message.count({
          where: { OR: [{ senderId: a.player.id }, { recipientId: a.player.id }] },
        })) === 0,
      );
      check(
        'den andre spilleren står igjen',
        (await prisma.player.findUnique({ where: { id: b.player.id } })) !== null,
      );
    }

    /* ================================================================== */
    section('12. Tjue samtidige meldinger');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();

      const results = await burst(20, (i) =>
        settle(() => sendMessage(a.player.id, b.player.id, `Samtidig ${i}`, `Nummer ${i}.`)),
      );

      const ok = results.filter((r) => r.ok);
      note(`ok=${ok.length}`);
      check('alle tjue blir opprettet', ok.length === 20, `${ok.length}`);

      const rows = await prisma.message.findMany({ where: { senderId: a.player.id } });
      check('nøyaktig tjue rader', rows.length === 20, `${rows.length}`);
      check('alle har unike id-er', new Set(rows.map((r) => r.id)).size === 20);
      check('alle har riktig mottaker', rows.every((r) => r.recipientId === b.player.id));
      check('alle er uleste', rows.every((r) => r.readAt === null));
      check('ulest-tallet stemmer', (await unreadCount(b.player.id)) === 20);
    }

    /* ================================================================== */
    section('13. Tjue samtidige markeringer');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const [id] = await seedMessages(a.player.id, b.player.id, 1);

      const results = await burst(20, () => settle(() => markAsRead(b.player.id, id!)));
      const ok = results.filter((r) => r.ok);
      const changed = results.filter(
        (r) => r.ok && (r.value as { changed: boolean }).changed,
      );

      note(`ok=${ok.length} endret=${changed.length}`);
      check('ingen av dem feiler', ok.length === 20, `${ok.length}`);
      check('nøyaktig én av dem endret noe', changed.length === 1, `${changed.length}`);

      const stored = await row(id!);
      check('tidspunktet er satt én gang', stored.readAt !== null);
      check(
        'alle svarene viser samme tidspunkt',
        results.every(
          (r) =>
            !r.ok ||
            (r.value as { message: { readAt: Date | null } }).message.readAt?.getTime() ===
              stored.readAt?.getTime(),
        ),
      );
      check('ulest-tallet er 0', (await unreadCount(b.player.id)) === 0);
    }

    /* ================================================================== */
    section('14. Samtidig sletting fra begge sider');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const ids = await seedMessages(a.player.id, b.player.id, 5, 'Begge');

      const results = await Promise.all(
        ids.flatMap((id) => [
          settle(() => deleteMessage(a.player.id, id)),
          settle(() => deleteMessage(b.player.id, id)),
        ]),
      );

      check('ingen av slettingene feiler', results.every((r) => r.ok));

      const rows = await prisma.message.findMany({ where: { id: { in: ids } } });
      check('alle radene finnes fortsatt', rows.length === 5, `${rows.length}`);
      check(
        'begge merkene ble satt på alle',
        rows.every((r) => r.senderDeletedAt !== null && r.recipientDeletedAt !== null),
        rows
          .map((r) => `${r.senderDeletedAt === null ? '-' : 'S'}${r.recipientDeletedAt === null ? '-' : 'M'}`)
          .join(','),
      );
      check(
        'ingen av dem ser meldingene lenger',
        (await listMessages(a.player.id, 'sendt')).messages.length === 0 &&
          (await listMessages(b.player.id, 'innboks')).messages.length === 0,
      );
    }

    /* ================================================================== */
    section('15. Samtidig lesing og sletting');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const ids = await seedMessages(a.player.id, b.player.id, 6, 'Kappløp');

      const results = await Promise.all(
        ids.flatMap((id) => [
          settle(() => markAsRead(b.player.id, id)),
          settle(() => deleteMessage(b.player.id, id)),
          settle(() => getMessage(b.player.id, id)),
        ]),
      );

      const failures = results.filter((r) => !r.ok);
      note(`${failures.length} operasjoner tapte kappløpet (forventet: 0 eller flere 404)`);
      check(
        'ingen uventede feil',
        failures.every((r) => r.code === 'IKKE_FUNNET'),
        failures.map((r) => r.code).join(','),
      );

      const rows = await prisma.message.findMany({ where: { id: { in: ids } } });
      check('alle radene er intakte', rows.length === 6);
      check('alle er slettet av mottakeren', rows.every((r) => r.recipientDeletedAt !== null));
      check(
        'lesetidspunktet er enten satt eller ikke, aldri ugyldig',
        rows.every((r) => r.readAt === null || r.readAt.getTime() <= Date.now()),
      );
      check('ulest-tallet er konsistent', (await unreadCount(b.player.id)) === 0);
    }

    /* ================================================================== */
    section('16. Eierskap under samtidighet');

    {
      const a = await createTestPlayer();
      const b = await createTestPlayer();
      const intruder = await createTestPlayer();
      const ids = await seedMessages(a.player.id, b.player.id, 4, 'Eierskap');

      const results = await Promise.all(
        ids.flatMap((id) => [
          settle(() => markAsRead(intruder.player.id, id)),
          settle(() => deleteMessage(intruder.player.id, id)),
          settle(() => getMessage(intruder.player.id, id)),
          settle(() => markAsRead(b.player.id, id)),
        ]),
      );

      const intruderResults = results.filter((_, i) => i % 4 !== 3);
      check(
        'alle inntrengerens forsøk avvises',
        intruderResults.every((r) => !r.ok && r.code === 'IKKE_FUNNET'),
        intruderResults.map((r) => r.code).join(','),
      );
      check(
        'mottakerens egne markeringer lykkes',
        results.filter((_, i) => i % 4 === 3).every((r) => r.ok),
      );

      const rows = await prisma.message.findMany({ where: { id: { in: ids } } });
      check('ingen slettemerker ble satt', rows.every((r) => r.recipientDeletedAt === null));
      check('alle ble lest av mottakeren', rows.every((r) => r.readAt !== null));
      check(
        'inntrengeren har fortsatt ingenting',
        (await listMessages(intruder.player.id, 'innboks')).messages.length === 0,
      );
    }

    /* ================================================================== */
    section('17. Rate limiting per spiller');

    {
      // Keyed on the account, so a fresh player starts with a clean bucket.
      const sender = await createTestPlayer();
      const target = await createTestPlayer();

      const results: Array<{ status: number; body: any }> = [];
      for (let i = 0; i < 25; i += 1) {
        results.push(
          await post(server.base, '/meldinger/send', {
            cookie: sender.cookie,
            body: { recipientId: target.player.id, subject: `Spam ${i}`, content: 'Hei.' },
          }),
        );
      }

      const created = results.filter((r) => r.status === 201).length;
      const limited = results.filter((r) => r.body?.error?.code === 'FOR_MANGE_FORSOK');

      note(`opprettet=${created} rate-limited=${limited.length}`);
      check('nøyaktig 20 slipper gjennom', created === 20, `${created}`);
      check('resten blokkeres', limited.length === 5, `${limited.length}`);
      check('status er 429', limited.every((r) => r.status === 429));
      check(
        'meldingen er på norsk',
        limited[0]?.body?.error?.message === 'Du sender meldinger for raskt. Vent litt.',
        limited[0]?.body?.error?.message,
      );
      check(
        'blokkerte forespørsler skriver ingenting',
        (await prisma.message.count({ where: { senderId: sender.player.id } })) === 20,
      );

      // The quota follows the account, not the address: another player on the
      // same connection is unaffected.
      const other = await createTestPlayer();
      const free = await post(server.base, '/meldinger/send', {
        cookie: other.cookie,
        body: { recipientId: target.player.id, subject: 'Egen kvote', content: 'Hei.' },
      });
      check('en annen spiller har egen kvote', free.status === 201, String(free.status));
    }

    {
      const owner = await createTestPlayer();
      const from = await createTestPlayer();
      const ids = await seedMessages(from.player.id, owner.player.id, 1, 'Grense');

      const marks: Array<{ status: number; body: any }> = [];
      for (let i = 0; i < 65; i += 1) {
        marks.push(
          await post(server.base, `/meldinger/${ids[0]}/les`, { cookie: owner.cookie }),
        );
      }
      const okMarks = marks.filter((r) => r.status === 200).length;
      const blocked = marks.filter((r) => r.status === 429).length;
      note(`markeringer ok=${okMarks} blokkert=${blocked}`);
      check('markering slipper gjennom 60', okMarks === 60, `${okMarks}`);
      check('resten blokkeres', blocked === 5, `${blocked}`);
      check(
        'meldingen er på norsk',
        marks.find((r) => r.status === 429)?.body?.error?.message ===
          'Du markerer meldinger for raskt. Vent litt.',
      );
    }

    {
      const owner = await createTestPlayer();
      const from = await createTestPlayer();
      const ids = await seedMessages(from.player.id, owner.player.id, 35, 'Slettegrense');

      const deletes: Array<{ status: number; body: any }> = [];
      for (const id of ids) {
        deletes.push(await post(server.base, `/meldinger/${id}/slett`, { cookie: owner.cookie }));
      }
      const okDeletes = deletes.filter((r) => r.status === 200).length;
      const blockedDeletes = deletes.filter((r) => r.status === 429).length;
      note(`slettinger ok=${okDeletes} blokkert=${blockedDeletes}`);
      check('sletting slipper gjennom 30', okDeletes === 30, `${okDeletes}`);
      check('resten blokkeres', blockedDeletes === 5, `${blockedDeletes}`);
      check(
        'blokkerte slettinger endrer ingenting',
        (await prisma.message.count({
          where: { recipientId: owner.player.id, recipientDeletedAt: null },
        })) === 5,
      );
    }

    /* ================================================================== */
    section('18. Ingen andre systemer er rørt');

    {
      const a = await createTestPlayer({ cash: 5000, energy: 100, heat: 0 });
      const b = await createTestPlayer({ cash: 5000 });
      const before = await reload(a.player.id);

      const [id] = await seedMessages(a.player.id, b.player.id, 1, 'Gratis');
      await markAsRead(b.player.id, id!);
      await deleteMessage(b.player.id, id!);

      const after = await reload(a.player.id);
      check('kontantene er urørt', after.cash === before.cash, `${after.cash}`);
      check('banken er urørt', after.bankBalance === before.bankBalance);
      check('energien er urørt', after.energy === before.energy, `${after.energy}`);
      check('heat er urørt', after.heat === before.heat);
      check('helsa er urørt', after.health === before.health);
      check('XP er urørt', after.xp === before.xp);
      check('nivået er urørt', after.level === before.level);
      check('ferdighetspoeng er urørt', after.skillPoints === before.skillPoints);
      check('distriktet er urørt', after.currentDistrictId === before.currentDistrictId);
      check(
        'ingen transaksjoner ble skrevet',
        (await prisma.transaction.count({ where: { playerId: a.player.id } })) === 0,
      );
      check(
        'ingen kriminalitetsforsøk ble skrevet',
        (await prisma.crimeAttempt.count({ where: { playerId: a.player.id } })) === 0,
      );
      check(
        'mottakeren er også urørt',
        (await reload(b.player.id)).cash === 5000,
      );
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
