import type { Prisma } from '@prisma/client';
import { MESSAGE_LIMITS, type MessageBox } from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, badRequest, notFound } from '../../lib/errors';

/**
 * A message together with the two usernames it needs to be displayed.
 *
 * The relations are selected down to id and username on purpose: a message must
 * never become a side channel for reading another player's cash, level or
 * position, and the narrowest possible select is what guarantees that.
 */
const WITH_PARTIES = {
  sender: { select: { id: true, username: true } },
  recipient: { select: { id: true, username: true } },
} satisfies Prisma.MessageInclude;

export type MessageWithParties = Prisma.MessageGetPayload<{ include: typeof WITH_PARTIES }>;

export interface MessagePage {
  messages: MessageWithParties[];
  /** Null when there is nothing after this page. */
  nextCursor: string | null;
}

export interface ListOptions {
  limit?: number;
  cursor?: string | undefined;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * One page of a player's inbox or sent box.
 *
 * The `where` clause is the access control: a listing is always scoped to the
 * caller in the role the box implies, and to the copy they have not deleted.
 * There is no code path that lists a message the caller is not part of.
 */
export async function listMessages(
  playerId: string,
  box: MessageBox,
  options: ListOptions = {},
): Promise<MessagePage> {
  const limit = Math.min(
    Math.max(options.limit ?? MESSAGE_LIMITS.pageSize, 1),
    MESSAGE_LIMITS.maxPageSize,
  );

  const where: Prisma.MessageWhereInput =
    box === 'sendt'
      ? { senderId: playerId, senderDeletedAt: null }
      : { recipientId: playerId, recipientDeletedAt: null };

  const rows = await prisma.message.findMany({
    where,
    include: WITH_PARTIES,
    // Newest first. The id breaks ties so two messages written in the same
    // millisecond cannot swap places between two pages.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return { messages: page, nextCursor: hasMore && last ? last.id : null };
}

/**
 * One message, readable by either party.
 *
 * A message the player is not part of - and one they have deleted their own
 * copy of - answers exactly the way a message that never existed does, so an id
 * alone reveals nothing about anyone else's post.
 */
export async function getMessage(
  playerId: string,
  messageId: string,
): Promise<MessageWithParties> {
  const row = await prisma.message.findFirst({
    where: {
      id: messageId,
      OR: [
        { recipientId: playerId, recipientDeletedAt: null },
        { senderId: playerId, senderDeletedAt: null },
      ],
    },
    include: WITH_PARTIES,
  });

  if (!row) throw notFound('Fant ikke denne meldingen.');
  return row;
}

/** How many unread messages are waiting, ignoring ones the player deleted. */
export async function unreadCount(playerId: string): Promise<number> {
  return prisma.message.count({
    where: { recipientId: playerId, readAt: null, recipientDeletedAt: null },
  });
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

export interface SendResult {
  message: MessageWithParties;
}

/**
 * Sends a message.
 *
 * The sender is always the authenticated player - a `senderId` in the request
 * body never reaches this function, because the schema does not describe one.
 * Subject and content arrive already trimmed and length-checked; the database
 * CHECK constraints are the backstop under that.
 */
export async function sendMessage(
  senderId: string,
  recipientId: string,
  subject: string,
  content: string,
): Promise<SendResult> {
  if (recipientId === senderId) {
    throw badRequest('Du kan ikke sende melding til deg selv.', 'IKKE_TIL_DEG_SELV');
  }

  const recipient = await prisma.player.findUnique({
    where: { id: recipientId },
    select: { id: true },
  });

  if (!recipient) throw notFound('Fant ikke spilleren du prøvde å sende til.');

  const row = await prisma.message.create({
    data: { senderId, recipientId: recipient.id, subject, content },
    include: WITH_PARTIES,
  });

  return { message: row };
}

/* ------------------------------------------------------------------ *
 * Marking as read
 * ------------------------------------------------------------------ */

export interface ReadResult {
  message: MessageWithParties;
  /** False when it was already read, so nothing needed changing. */
  changed: boolean;
}

/**
 * Marks a message read.
 *
 * The update is the whole operation: a single conditional statement scoped to
 * the recipient and to `readAt: null`. Twenty simultaneous requests therefore
 * produce one write and one timestamp - the other nineteen match no row and
 * quietly find it already read. No lock is taken, because there is no read
 * followed by a write that a lock would need to protect.
 *
 * Only the recipient can do this. A sender opening their own sent message does
 * not mark it read for the person who has not seen it.
 */
export async function markAsRead(
  playerId: string,
  messageId: string,
): Promise<ReadResult> {
  const claimed = await prisma.message.updateMany({
    where: {
      id: messageId,
      recipientId: playerId,
      recipientDeletedAt: null,
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  const row = await prisma.message.findFirst({
    where: { id: messageId, recipientId: playerId, recipientDeletedAt: null },
    include: WITH_PARTIES,
  });

  // Not the recipient, or their copy is gone: the same answer either way.
  if (!row) throw notFound('Fant ikke denne meldingen.');

  return { message: row, changed: claimed.count === 1 };
}

/* ------------------------------------------------------------------ *
 * Deleting
 * ------------------------------------------------------------------ */

export interface DeleteResult {
  /** False when this side had already deleted their copy. */
  changed: boolean;
  /** Which side of the message the caller was on. */
  role: 'sender' | 'recipient';
}

/**
 * Deletes the caller's own copy.
 *
 * Nothing is removed from the database. Each side owns one nullable timestamp
 * and writes only that column, so a sender and a recipient deleting the same
 * message at the same moment cannot lose each other's update: the row lock
 * Postgres takes for each statement serialises them, and neither statement
 * touches the other's field.
 *
 * A message both sides have deleted simply stops being visible to anyone.
 */
export async function deleteMessage(
  playerId: string,
  messageId: string,
): Promise<DeleteResult> {
  const now = new Date();

  const asRecipient = await prisma.message.updateMany({
    where: { id: messageId, recipientId: playerId, recipientDeletedAt: null },
    data: { recipientDeletedAt: now },
  });

  if (asRecipient.count === 1) return { changed: true, role: 'recipient' };

  const asSender = await prisma.message.updateMany({
    where: { id: messageId, senderId: playerId, senderDeletedAt: null },
    data: { senderDeletedAt: now },
  });

  if (asSender.count === 1) return { changed: true, role: 'sender' };

  // Nothing moved. Either the caller is not part of this message - in which
  // case they get the same answer as for an id that does not exist - or they
  // had already deleted their copy, which is not an error.
  const row = await prisma.message.findFirst({
    where: { id: messageId, OR: [{ senderId: playerId }, { recipientId: playerId }] },
    select: { senderId: true, recipientId: true },
  });

  if (!row) throw notFound('Fant ikke denne meldingen.');

  return {
    changed: false,
    role: row.recipientId === playerId ? 'recipient' : 'sender',
  };
}

/* ------------------------------------------------------------------ *
 * Finding somebody to write to
 * ------------------------------------------------------------------ */

/**
 * Looks up players by name so the compose form can address a message.
 *
 * Returns nothing but ids and usernames, never the player rows themselves, and
 * always excludes the caller. Deliberately requires something to search for:
 * this is a lookup, not a way to enumerate everyone in the city.
 */
export async function findRecipients(
  playerId: string,
  query: string,
): Promise<Array<{ id: string; username: string }>> {
  const term = query.trim();

  if (term.length < 2) {
    throw new AppError(400, 'FOR_KORT_SOK', 'Skriv minst to tegn for å søke.');
  }

  return prisma.player.findMany({
    where: {
      usernameLower: { contains: term.toLowerCase() },
      NOT: { id: playerId },
    },
    select: { id: true, username: true },
    orderBy: { usernameLower: 'asc' },
    take: 10,
  });
}
