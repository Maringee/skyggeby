import type { Request, Response } from 'express';
import type {
  MissionAbandonResponse,
  MissionAcceptResponse,
  MissionDeliverResponse,
  MissionDetailResponse,
  MissionListResponse,
} from '@skyggeby/shared';
import { toPlayerDto, toTransactionDto } from '../../lib/serialize';
import { missionIdParamSchema, parseOrThrow } from '../../lib/validation';
import { toMissionDto } from './mission.serializer';
import {
  abandonMission,
  acceptMission,
  deliverMission,
  getMission,
  listMissions,
  type MissionOverview,
} from './mission.service';

/** The shared shape every mutation echoes back, so one call refreshes the page. */
function overviewFields(overview: MissionOverview) {
  return {
    missions: overview.views.map(toMissionDto),
    player: toPlayerDto(overview.player),
    activeCount: overview.activeCount,
    deliverableCount: overview.deliverableCount,
  };
}

export async function getMissions(req: Request, res: Response) {
  const overview = await listMissions(req.player!.id);

  const body: MissionListResponse = {
    ...overviewFields(overview),
    maxActive: overview.maxActive,
    chainContinues: overview.chainContinues,
  };
  res.status(200).json(body);
}

export async function getMissionById(req: Request, res: Response) {
  const { missionId } = parseOrThrow(missionIdParamSchema, req.params);

  const { player, view } = await getMission(req.player!.id, missionId);

  const body: MissionDetailResponse = {
    mission: toMissionDto(view),
    player: toPlayerDto(player),
  };
  res.status(200).json(body);
}

export async function postAccept(req: Request, res: Response) {
  // Only the id is read. Everything a mission is worth comes from the server's
  // own catalogue, so there is nothing else in the request worth looking at.
  const { missionId } = parseOrThrow(missionIdParamSchema, req.params);

  const result = await acceptMission(req.player!.id, missionId);
  const accepted = result.overview.views.find((view) => view.definition.id === missionId);

  const body: MissionAcceptResponse = {
    ...overviewFields(result.overview),
    mission: toMissionDto(accepted ?? result.overview.views[0]!),
    maxActive: result.overview.maxActive,
    message: result.message,
  };
  res.status(201).json(body);
}

export async function postDeliver(req: Request, res: Response) {
  const { missionId } = parseOrThrow(missionIdParamSchema, req.params);

  const result = await deliverMission(req.player!.id, missionId);
  const finished = result.overview.views.find((view) => view.definition.id === missionId);

  const body: MissionDeliverResponse = {
    ...overviewFields(result.overview),
    mission: toMissionDto(finished ?? result.overview.views[0]!),
    transactions: result.transactions.map(toTransactionDto),
    cash: result.cash,
    xpGained: result.xpGained,
    trustGained: result.trustGained,
    heatChange: result.heatChange,
    leveledUp: result.leveledUp,
    newLevel: result.newLevel,
    skillPointsGained: result.skillPointsGained,
    informationGiven: result.informationGiven,
    unlockedMissions: result.unlocked.missions.map((entry) => entry.name),
    unlockedContacts: result.unlocked.contacts.map((entry) => entry.name),
    debriefing: result.debriefing,
    message: result.message,
  };
  res.status(200).json(body);
}

export async function postAbandon(req: Request, res: Response) {
  const { missionId } = parseOrThrow(missionIdParamSchema, req.params);

  const result = await abandonMission(req.player!.id, missionId);

  const body: MissionAbandonResponse = {
    ...overviewFields(result.overview),
    message: result.message,
  };
  res.status(200).json(body);
}
