import type { ContactRelationship } from '@prisma/client';
import {
  CONTACTS,
  CONTACT_STATUS_BLOCK_REASONS,
  TRUST_TUNING,
  adjustTrust,
  canContactStatus,
  contactsInDistrict,
  findContact,
  resolveDistrict,
  type ContactDefinition,
  type ContactStatus,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, notFound } from '../../lib/errors';
import { pickOne } from '../../lib/random';
import { lockPlayer } from '../economy/transaction.service';

export interface DiscoverResult {
  /** Null when nobody new turned up. */
  relationship: ContactRelationship | null;
  message: string;
}

export interface InteractResult {
  relationship: ContactRelationship;
  trustGained: number;
  message: string;
}

/** Everyone the player knows, most recently discovered first. */
export async function listRelationships(playerId: string): Promise<ContactRelationship[]> {
  return prisma.contactRelationship.findMany({
    where: { playerId },
    orderBy: [{ discoveredAt: 'desc' }],
    take: 200,
  });
}

/**
 * One relationship, scoped to its owner.
 *
 * A contact the player does not know answers the same way one that does not
 * exist does, so an id alone reveals nothing about anyone else's network.
 */
export async function getRelationship(
  playerId: string,
  contactId: string,
): Promise<ContactRelationship> {
  const row = await prisma.contactRelationship.findFirst({
    where: { playerId, contactId },
  });

  if (!row) throw notFound('Du kjenner ikke denne personen.');
  return row;
}

/**
 * Meets someone new.
 *
 * The player's own district is read from their locked row and preferred, but
 * the search widens to the rest of the city rather than dead-ending. The
 * unique constraint on (playerId, contactId) is the real guarantee: even if two
 * requests somehow chose the same person, only one row can exist.
 */
export async function discoverContact(playerId: string): Promise<DiscoverResult> {
  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);

    const player = await tx.player.findUnique({ where: { id: playerId } });
    if (!player) throw notFound('Fant ikke spilleren.');

    const known = await tx.contactRelationship.findMany({
      where: { playerId },
      select: { contactId: true },
    });
    const knownIds = new Set(known.map((row) => row.contactId));

    const district = resolveDistrict(player.currentDistrictId);

    // People here first; the rest of the city only if this district is spent.
    const local = contactsInDistrict(district.id).filter((c) => !knownIds.has(c.id));
    const elsewhere = CONTACTS.filter(
      (c) => !knownIds.has(c.id) && c.districtId !== district.id,
    );

    const pool = local.length > 0 ? local : elsewhere;

    if (pool.length === 0) {
      return {
        relationship: null,
        message: 'Du fant ingen nye kontakter denne gangen.',
      };
    }

    const chosen = pickOne(pool, pool[0]!) as ContactDefinition;

    const relationship = await tx.contactRelationship.create({
      data: {
        playerId,
        contactId: chosen.id,
        trust: TRUST_TUNING.start,
        status: 'AVAILABLE',
      },
    });

    const home = resolveDistrict(chosen.districtId);
    return {
      relationship,
      message:
        local.length > 0
          ? `Du ble kjent med ${chosen.name} i ${home.name}.`
          : `Du ble tipset om ${chosen.name} i ${home.name}.`,
    };
  });
}

/**
 * Talks to someone the player already knows.
 *
 * Trust is read and written under the player's row lock and always goes through
 * `adjustTrust`, so twenty simultaneous conversations cannot push it past 100
 * or lose an update between them.
 */
export async function interactWithContact(
  playerId: string,
  contactId: string,
): Promise<InteractResult> {
  const definition = findContact(contactId);
  if (!definition) {
    throw notFound('Du kjenner ikke denne personen.');
  }

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);

    const relationship = await tx.contactRelationship.findFirst({
      where: { playerId, contactId },
    });

    if (!relationship) {
      // Same answer as an unknown id: nothing is revealed either way.
      throw notFound('Du kjenner ikke denne personen.');
    }

    const status = relationship.status as ContactStatus;
    if (!canContactStatus(status)) {
      throw new AppError(
        400,
        'IKKE_TILGJENGELIG',
        CONTACT_STATUS_BLOCK_REASONS[status] ?? 'Personen er ikke tilgjengelig.',
      );
    }

    const nextTrust = adjustTrust(relationship.trust, TRUST_TUNING.perInteraction);
    const trustGained = nextTrust - relationship.trust;

    const updated = await tx.contactRelationship.update({
      where: { id: relationship.id },
      data: { trust: nextTrust, lastInteractionAt: new Date() },
    });

    return {
      relationship: updated,
      trustGained,
      message:
        trustGained > 0
          ? `Du tok en prat med ${definition.name}.`
          : `Du tok en prat med ${definition.name}. Dere står allerede så nær som dere kan.`,
    };
  });
}

/** How many people exist in total, for the "what is left" hint. */
export const TOTAL_CONTACTS = CONTACTS.length;
