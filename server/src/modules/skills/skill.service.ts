import type { Player, PlayerSkill, Prisma } from '@prisma/client';
import {
  SKILLS,
  SKILL_TUNING,
  clampSkillLevel,
  findSkill,
  skillCurve,
  type SkillDto,
  type SkillId,
} from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { AppError, notFound } from '../../lib/errors';
import { lockPlayer } from '../economy/transaction.service';
import {
  describeCurrentEffect,
  describeNextEffect,
  type SkillLevels,
} from './skill.effects';

export interface UpgradeResult {
  player: Player;
  skills: SkillDto[];
  upgraded: SkillDto;
  message: string;
}

/**
 * Reads a player's skill levels.
 *
 * A missing row is level 0 rather than an error: accounts always have all six
 * rows in practice, but nothing downstream should break if one is ever absent.
 */
export function levelsFromRows(rows: PlayerSkill[]): SkillLevels {
  const levels: SkillLevels = {};
  for (const row of rows) {
    const definition = findSkill(row.skillId);
    if (!definition) continue;
    levels[definition.id] = clampSkillLevel(row.level, definition.maxLevel);
  }
  return levels;
}

export async function getSkillLevels(playerId: string): Promise<SkillLevels> {
  const rows = await prisma.playerSkill.findMany({ where: { playerId } });
  return levelsFromRows(rows);
}

/** Same, inside an open transaction. */
export async function getSkillLevelsTx(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<SkillLevels> {
  const rows = await tx.playerSkill.findMany({ where: { playerId } });
  return levelsFromRows(rows);
}

/** Creates the full set of skills for a new player, all at level 0. */
export async function createSkillsForPlayer(
  tx: Prisma.TransactionClient,
  playerId: string,
): Promise<void> {
  await tx.playerSkill.createMany({
    data: SKILLS.map((skill) => ({ playerId, skillId: skill.id, level: 0 })),
    skipDuplicates: true,
  });
}

/** The whole catalogue as the player sees it. */
export function buildSkillState(player: Player, levels: SkillLevels): SkillDto[] {
  return SKILLS.map((skill) => {
    const level = levels[skill.id] ?? 0;
    const atMax = level >= skill.maxLevel;
    const affordable = player.skillPoints >= SKILL_TUNING.upgradeCost;

    let blockedText: string | null = null;
    if (atMax) blockedText = 'Ferdigheten er på maks nivå.';
    else if (!affordable) blockedText = 'Du har ingen ferdighetspoeng.';

    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      focus: skill.focus,
      level,
      maxLevel: skill.maxLevel,
      progress: skillCurve(level, skill.maxLevel),
      currentEffect: describeCurrentEffect(skill.id, level),
      nextEffect: describeNextEffect(skill.id, level),
      dormant: skill.dormant,
      atMax,
      canUpgrade: !atMax && affordable,
      blockedText,
    } satisfies SkillDto;
  });
}

export async function listSkills(player: Player): Promise<SkillDto[]> {
  return buildSkillState(player, await getSkillLevels(player.id));
}

/**
 * Spends one skill point on one skill.
 *
 * The client names a skill and nothing else. Whether it exists, whether the
 * player can afford it, and what the new level is are all decided here, under
 * the same row lock every other state change uses — so two requests racing for
 * a single point cannot both win it.
 */
export async function upgradeSkill(
  playerId: string,
  skillId: string,
): Promise<UpgradeResult> {
  const definition = findSkill(skillId);
  if (!definition) {
    throw notFound('Denne ferdigheten finnes ikke.');
  }

  return prisma.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);

    const player = await tx.player.findUnique({ where: { id: playerId } });
    if (!player) throw notFound('Fant ikke spilleren.');

    if (player.skillPoints < SKILL_TUNING.upgradeCost) {
      throw new AppError(
        400,
        'INGEN_FERDIGHETSPOENG',
        'Du har ingen ferdighetspoeng å bruke.',
      );
    }

    const existing = await tx.playerSkill.findUnique({
      where: { playerId_skillId: { playerId, skillId: definition.id } },
    });

    const currentLevel = clampSkillLevel(existing?.level ?? 0, definition.maxLevel);

    if (currentLevel >= definition.maxLevel) {
      throw new AppError(
        400,
        'MAKS_NIVA',
        `${definition.name} er allerede på maks nivå (${definition.maxLevel}).`,
      );
    }

    const nextLevel = currentLevel + 1;

    const updatedPlayer = await tx.player.update({
      where: { id: playerId },
      data: { skillPoints: { decrement: SKILL_TUNING.upgradeCost } },
    });

    await tx.playerSkill.upsert({
      where: { playerId_skillId: { playerId, skillId: definition.id } },
      create: { playerId, skillId: definition.id, level: nextLevel },
      update: { level: nextLevel },
    });

    const levels = await getSkillLevelsTx(tx, playerId);
    const skills = buildSkillState(updatedPlayer, levels);
    const upgraded = skills.find((s) => s.id === definition.id)!;

    return {
      player: updatedPlayer,
      skills,
      upgraded,
      message: `${definition.name} er nå nivå ${nextLevel}.`,
    };
  });
}
