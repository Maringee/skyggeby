/**
 * Turning a mission view into what the client is allowed to see.
 *
 * Two things are deliberately withheld:
 *
 *  - the debriefing, until the mission is actually finished. It is the payoff
 *    line, and reading it in the list would spend it.
 *  - the reward figures, while the mission is locked behind trust. What a
 *    contact pays for their better work is something you learn by earning it,
 *    and the requirement is still shown so the player knows what to go and do.
 *
 * Nothing internal ever crosses: no `reliability` from the contact catalogue,
 * no truth flags, no rows belonging to anyone else.
 */
import {
  MISSION_AVAILABILITY_LABELS,
  MISSION_CATEGORY_LABELS,
  findContact,
  findContactType,
  findMission,
  resolveDistrict,
  type MissionAvailability,
  type MissionCategory,
  type MissionDto,
  type MissionRewardDto,
} from '@skyggeby/shared';
import type { MissionView } from './mission.service';

/** Whether the reason this mission is locked is a trust the player lacks. */
function lockedByTrust(view: MissionView): boolean {
  if (view.availability !== 'LAAST') return false;
  if (view.definition.requirements.minTrust <= 0) return false;

  return view.conditions.some(
    (condition) => !condition.met && condition.label.includes('Krever ') && condition.label.includes(' hos '),
  );
}

function rewardsOf(view: MissionView, hidden: boolean): MissionRewardDto {
  const rewards = view.definition.rewards;

  if (hidden) {
    return {
      cash: 0,
      xp: 0,
      trust: 0,
      heatChange: 0,
      information: false,
      unlocksMissions: [],
      unlocksContacts: [],
    };
  }

  return {
    cash: rewards.cash,
    xp: rewards.xp,
    trust: rewards.trust,
    heatChange: rewards.heatChange,
    information: rewards.information !== null,
    // Names, not ids: this is copy for the player, not a key to look anything
    // up with.
    unlocksMissions: view.definition.unlocks.missionIds
      .map((id) => findMission(id)?.name)
      .filter((name): name is string => Boolean(name)),
    unlocksContacts: view.definition.unlocks.contactIds
      .map((id) => findContact(id)?.name)
      .filter((name): name is string => Boolean(name)),
  };
}

export function toMissionDto(view: MissionView): MissionDto {
  const definition = view.definition;
  const contact = findContact(definition.contactId);
  const district = resolveDistrict(contact?.districtId ?? 'sentrum');
  const contactType = contact ? findContactType(contact.type) : undefined;

  const hidden = lockedByTrust(view);
  const finished = view.availability === 'FULLFORT';

  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    categoryLabel: MISSION_CATEGORY_LABELS[definition.category as MissionCategory],
    contactId: definition.contactId,
    contactName: contact?.name ?? definition.contactId,
    contactTypeLabel: contactType?.role ?? '',
    districtId: district.id,
    districtName: district.name,
    minLevel: definition.minLevel,
    briefing: definition.briefing,
    debriefing: finished ? definition.debriefing : null,
    availability: view.availability,
    availabilityLabel:
      MISSION_AVAILABILITY_LABELS[view.availability as MissionAvailability],
    conditions: view.conditions.map((condition) => ({
      met: condition.met,
      label: condition.label,
      actual: condition.actual,
    })),
    objectives: view.objectives.map((objective) => ({
      kind: objective.kind,
      label: objective.label,
      actual: objective.actual,
      met: objective.met,
      current: objective.current,
      target: objective.target,
    })),
    rewards: rewardsOf(view, hidden),
    rewardsHidden: hidden,
    deliverable: view.deliverable,
    blockedReason: view.blockedReason,
    blockedSeconds: view.blockedSeconds,
    repeatable: definition.repeatable,
    requiresMissions: definition.requiresMissions
      .map((id) => findMission(id)?.name)
      .filter((name): name is string => Boolean(name)),
    acceptedAt: view.row?.acceptedAt.toISOString() ?? null,
    expiresAt: view.row?.expiresAt?.toISOString() ?? null,
    completedAt: view.completedAt?.toISOString() ?? null,
    progressCount: view.row?.progressCount ?? 0,
  };
}
