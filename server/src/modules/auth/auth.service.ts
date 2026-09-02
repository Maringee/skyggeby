import type { Player } from '@prisma/client';
import { STARTING_STATS } from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { conflict, unauthorized } from '../../lib/errors';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../../lib/password';
import { recordInitialGrant } from '../economy/transaction.service';
import { createSkillsForPlayer } from '../skills/skill.service';

export async function registerPlayer(
  username: string,
  password: string,
): Promise<Player> {
  const usernameLower = username.toLowerCase();

  const existing = await prisma.player.findUnique({ where: { usernameLower } });
  if (existing) {
    throw conflict('Brukernavnet er allerede tatt.', 'BRUKERNAVN_OPPTATT');
  }

  const passwordHash = await hashPassword(password);

  try {
    return await prisma.$transaction(async (tx) => {
      const player = await tx.player.create({
        data: {
          username,
          usernameLower,
          passwordHash,
          ...STARTING_STATS,
        },
      });

      // The starting capital must be traceable like any other money movement.
      await recordInitialGrant(tx, player);

      // Every player owns all six skills from the first second, at level 0.
      await createSkillsForPlayer(tx, player.id);

      return player;
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw conflict('Brukernavnet er allerede tatt.', 'BRUKERNAVN_OPPTATT');
    }
    throw error;
  }
}

export async function authenticate(
  username: string,
  password: string,
): Promise<Player> {
  const player = await prisma.player.findUnique({
    where: { usernameLower: username.toLowerCase() },
  });

  // Same generic message either way, so the endpoint cannot be used to probe
  // which usernames exist.
  const failure = unauthorized('Feil brukernavn eller passord.');

  if (!player) {
    // Burn the same amount of CPU as a real check so the response time does
    // not reveal whether the username exists.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    throw failure;
  }

  const ok = await verifyPassword(password, player.passwordHash);
  if (!ok) throw failure;

  return player;
}
