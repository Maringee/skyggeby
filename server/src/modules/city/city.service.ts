import type { Player } from '@prisma/client';
import {
  DISTRICTS,
  activityLabel,
  describeModifiers,
  districtRiskLabel,
  findDistrict,
  policeLabel,
  resolveDistrict,
  type DistrictStateDto,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, notFound } from '../../lib/errors';
import { lockPlayer } from '../economy/transaction.service';

export interface MoveResult {
  player: Player;
  districts: DistrictStateDto[];
  message: string;
  /** False when the player already stood in that district. */
  moved: boolean;
}

/**
 * The whole city as the given player sees it. Purely derived from the
 * catalogue plus where the player stands - no district-specific branching.
 */
export function buildCityState(player: Player): DistrictStateDto[] {
  const current = resolveDistrict(player.currentDistrictId);

  return DISTRICTS.map((district) => ({
    id: district.id,
    name: district.name,
    description: district.description,
    tagline: district.tagline,
    policePresence: district.policePresence,
    risk: district.risk,
    activity: district.activity,
    policeLabel: policeLabel(district.policePresence),
    riskLabel: districtRiskLabel(district.risk),
    activityLabel: activityLabel(district.activity),
    position: district.position,
    effects: describeModifiers(district),
    current: district.id === current.id,
  }));
}

/**
 * Moves a player to another district.
 *
 * The client names a district; the server decides whether it exists and writes
 * the change under the same row lock every other state change uses, so a move
 * cannot interleave with a crime or a bank operation.
 */
export async function moveToDistrict(
  playerId: string,
  districtId: string,
): Promise<MoveResult> {
  const target = findDistrict(districtId);
  if (!target) {
    throw notFound('Dette distriktet finnes ikke.');
  }

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);

    const player = await tx.player.findUnique({ where: { id: playerId } });
    if (!player) throw notFound('Fant ikke spilleren.');

    if (player.currentDistrictId === target.id) {
      // Idempotent: standing still is not an error, it is just nothing.
      return {
        player,
        districts: buildCityState(player),
        message: `Du er allerede i ${target.name}.`,
        moved: false,
      };
    }

    const updated = await tx.player.update({
      where: { id: playerId },
      data: { currentDistrictId: target.id },
    });

    return {
      player: updated,
      districts: buildCityState(updated),
      message: `Du er nå i ${target.name}.`,
      moved: true,
    };
  });
}

/**
 * Guard for systems that require the player to be somewhere specific later on.
 * Unused for now, but keeps district checks out of feature code when they come.
 */
export function assertInDistrict(player: Player, districtId: string): void {
  if (player.currentDistrictId !== districtId) {
    const target = resolveDistrict(districtId);
    throw new AppError(
      400,
      'FEIL_DISTRIKT',
      `Du må være i ${target.name} for å gjøre dette.`,
    );
  }
}
