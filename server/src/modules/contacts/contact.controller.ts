import type { Request, Response } from 'express';
import type {
  ContactDetailResponse,
  ContactDiscoverResponse,
  ContactInteractResponse,
  ContactListResponse,
} from '@skyggeby/shared';
import { toContactDto } from '../../lib/serialize';
import {
  contactActionSchema,
  contactIdParamSchema,
  parseOrThrow,
} from '../../lib/validation';
import {
  TOTAL_CONTACTS,
  discoverContact,
  getRelationship,
  interactWithContact,
  listRelationships,
} from './contact.service';

export async function getContacts(req: Request, res: Response) {
  const rows = await listRelationships(req.player!.id);

  const body: ContactListResponse = {
    contacts: rows.map(toContactDto),
    count: rows.length,
    totalKnown: TOTAL_CONTACTS,
  };
  res.status(200).json(body);
}

export async function getContactById(req: Request, res: Response) {
  const { contactId } = parseOrThrow(contactIdParamSchema, req.params);

  const row = await getRelationship(req.player!.id, contactId);

  const body: ContactDetailResponse = { contact: toContactDto(row) };
  res.status(200).json(body);
}

export async function postDiscover(req: Request, res: Response) {
  // The client sends nothing at all: who turns up is decided from the player's
  // own district and the people they already know.
  const result = await discoverContact(req.player!.id);
  const rows = await listRelationships(req.player!.id);

  const body: ContactDiscoverResponse = {
    contact: result.relationship ? toContactDto(result.relationship) : null,
    found: result.relationship !== null,
    message: result.message,
    contacts: rows.map(toContactDto),
  };
  res.status(200).json(body);
}

export async function postInteract(req: Request, res: Response) {
  const { contactId } = parseOrThrow(contactActionSchema, req.body);

  const result = await interactWithContact(req.player!.id, contactId);
  const rows = await listRelationships(req.player!.id);

  const body: ContactInteractResponse = {
    contact: toContactDto(result.relationship),
    contacts: rows.map(toContactDto),
    trustGained: result.trustGained,
    message: result.message,
  };
  res.status(200).json(body);
}
