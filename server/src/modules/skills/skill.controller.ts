import type { Request, Response } from 'express';
import {
  SKILL_TUNING,
  type SkillListResponse,
  type SkillUpgradeResponse,
} from '@skyggeby/shared';
import { toPlayerDto } from '../../lib/serialize';
import { parseOrThrow, skillUpgradeSchema } from '../../lib/validation';
import { syncVitals } from '../player/progression.service';
import { listSkills, upgradeSkill } from './skill.service';

export async function getSkills(req: Request, res: Response) {
  const player = await syncVitals(req.player!.id);

  const body: SkillListResponse = {
    skills: await listSkills(player),
    skillPoints: player.skillPoints,
    upgradeCost: SKILL_TUNING.upgradeCost,
    player: toPlayerDto(player),
  };
  res.status(200).json(body);
}

export async function postUpgrade(req: Request, res: Response) {
  // Only the skill id is read. Any level, point total or bonus in the body is
  // not part of the schema and never reaches the service.
  const { skillId } = parseOrThrow(skillUpgradeSchema, req.body);

  const result = await upgradeSkill(req.player!.id, skillId);

  const body: SkillUpgradeResponse = {
    skill: result.upgraded,
    skills: result.skills,
    skillPoints: result.player.skillPoints,
    player: toPlayerDto(result.player),
    message: result.message,
  };
  res.status(200).json(body);
}
