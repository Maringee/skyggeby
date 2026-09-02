import type { Request, Response } from 'express';
import {
  MESSAGE_LIMITS,
  type MessageBox,
  type MessageDeleteResponse,
  type MessageDetailResponse,
  type MessageListResponse,
  type MessageReadResponse,
  type MessageRecipientsResponse,
  type MessageSendResponse,
  type UnreadCountResponse,
} from '@skyggeby/shared';
import { toMessageDto, toMessageSummaryDto } from '../../lib/serialize';
import {
  messageIdParamSchema,
  messageListQuerySchema,
  messageRecipientQuerySchema,
  messageSendSchema,
  parseOrThrow,
} from '../../lib/validation';
import {
  deleteMessage,
  findRecipients,
  getMessage,
  listMessages,
  markAsRead,
  sendMessage,
  unreadCount,
} from './message.service';

export async function getMessages(req: Request, res: Response) {
  const query = parseOrThrow(messageListQuerySchema, req.query);
  const playerId = req.player!.id;

  const box: MessageBox = query.boks ?? 'innboks';
  const page = await listMessages(playerId, box, {
    limit: query.limit ?? MESSAGE_LIMITS.pageSize,
    cursor: query.cursor,
  });

  const body: MessageListResponse = {
    messages: page.messages.map((row) => toMessageSummaryDto(row, playerId)),
    box,
    nextCursor: page.nextCursor,
    count: page.messages.length,
    unread: await unreadCount(playerId),
  };
  res.status(200).json(body);
}

export async function getUnread(req: Request, res: Response) {
  // Deliberately nothing but the number.
  const body: UnreadCountResponse = { count: await unreadCount(req.player!.id) };
  res.status(200).json(body);
}

export async function getRecipients(req: Request, res: Response) {
  const { sok } = parseOrThrow(messageRecipientQuerySchema, req.query);

  const players = await findRecipients(req.player!.id, sok);

  const body: MessageRecipientsResponse = { players };
  res.status(200).json(body);
}

export async function getMessageById(req: Request, res: Response) {
  const { messageId } = parseOrThrow(messageIdParamSchema, req.params);
  const playerId = req.player!.id;

  const row = await getMessage(playerId, messageId);

  const body: MessageDetailResponse = {
    message: toMessageDto(row, playerId),
    unread: await unreadCount(playerId),
  };
  res.status(200).json(body);
}

export async function postSend(req: Request, res: Response) {
  // Only the recipient, the subject and the body are read. The sender is the
  // session's, never the request's.
  const { recipientId, subject, content } = parseOrThrow(messageSendSchema, req.body);
  const playerId = req.player!.id;

  const result = await sendMessage(playerId, recipientId, subject, content);

  const body: MessageSendResponse = {
    sent: toMessageDto(result.message, playerId),
    message: `Meldingen ble sendt til ${result.message.recipient.username}.`,
  };
  res.status(201).json(body);
}

export async function postRead(req: Request, res: Response) {
  const { messageId } = parseOrThrow(messageIdParamSchema, req.params);
  const playerId = req.player!.id;

  const result = await markAsRead(playerId, messageId);

  const body: MessageReadResponse = {
    read: toMessageDto(result.message, playerId),
    message: result.changed ? 'Meldingen er markert som lest.' : 'Meldingen var allerede lest.',
    unread: await unreadCount(playerId),
  };
  res.status(200).json(body);
}

export async function postDelete(req: Request, res: Response) {
  const { messageId } = parseOrThrow(messageIdParamSchema, req.params);
  const playerId = req.player!.id;

  const result = await deleteMessage(playerId, messageId);

  const body: MessageDeleteResponse = {
    message: result.changed
      ? 'Meldingen er slettet.'
      : 'Meldingen var allerede slettet.',
    unread: await unreadCount(playerId),
  };
  res.status(200).json(body);
}
