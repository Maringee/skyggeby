/**
 * Whether a player may take a mission, and how far along one is.
 *
 * Deliberately pure. Everything this module needs arrives in a
 * {@link MissionContext} that the service loads once, so the same code answers
 * for the list the player browses and for the delivery that pays out. If those
 * two ever disagreed, the button and the server would disagree - and the button
 * is the one that lies.
 *
 * Every unmet condition carries both what is required and what the player
 * actually has. "Du oppfyller ikke kravene" tells nobody anything; "Krever nivå
 * 5, du er nivå 3" tells them what to go and do.
 */
import type { Asset, Player } from '@prisma/client';
import {
  findAssetType,
  findContact,
  findSkill,
  findCrime,
  findMission,
  isEventObjective,
  objectiveTarget,
  describeObjective,
  resolveDistrict,
  resolveFreshness,
  trustLabel,
  type InformationRelevance,
  type MissionDefinition,
  type MissionObjective,
} from '@skyggeby/shared';

/* ------------------------------------------------------------------ *
 * Context
 * ------------------------------------------------------------------ */

/** One vehicle, reduced to the three things a mission can ask about. */
export interface MissionVehicleView {
  vehicleTypeId: string;
  districtId: string;
  condition: number;
}

/** One piece of knowledge, reduced to what an objective can ask about. */
export interface MissionKnowledgeView {
  relevance: InformationRelevance;
  districtId: string | null;
  discoveredAt: Date;
  expiresAt: Date | null;
  usedAt: Date | null;
}

/**
 * Everything the evaluator is allowed to look at.
 *
 * Built once per request from the database. Nothing in here comes from the
 * client, and nothing in here is a promise - the evaluator never queries
 * anything itself, which is what makes it testable without a database.
 */
export interface MissionContext {
  player: Player;
  now: Date;
  /** Trust per contact the player knows. Absent means they have not met. */
  trustByContact: Map<string, number>;
  completedMissionIds: Set<string>;
  /** Every asset owned, carried or not. */
  assets: Asset[];
  vehicles: MissionVehicleView[];
  businessDistrictIds: string[];
  propertyDistrictIds: string[];
  knowledge: MissionKnowledgeView[];
  /**
   * Trained skill levels, keyed by skill id, straight from the existing
   * PlayerSkill rows. A skill with no row reads as 0 rather than as missing,
   * which is what the skill service already guarantees.
   */
  skillLevels: Record<string, number>;
}

export interface ConditionResult {
  met: boolean;
  /** What is being asked for, in Norwegian. */
  label: string;
  /** What the player actually has, in Norwegian. */
  actual: string;
}

export interface ObjectiveResult extends ConditionResult {
  kind: string;
  /** How far along, for the "x av y" readout. */
  current: number;
  target: number;
}

export interface MissionEvaluation {
  conditions: ConditionResult[];
  eligible: boolean;
  /** The first unmet condition, as one line. */
  blockedReason: string | null;
}

export interface ObjectiveEvaluation {
  objectives: ObjectiveResult[];
  complete: boolean;
  /** The first unmet objective, as one line. */
  missingReason: string | null;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const kr = (amount: number) => `${amount.toLocaleString('nb-NO')} kr`;

function districtName(districtId: string): string {
  return resolveDistrict(districtId).name;
}

function carried(context: MissionContext): Asset[] {
  return context.assets.filter((asset) => asset.storageLocation === 'INVENTORY');
}

/** Worth of the valuables in hand. What they are does not matter, only value. */
export function carriedValue(context: MissionContext): number {
  return carried(context)
    .filter((asset) => asset.category === 'VALUABLE')
    .reduce((sum, asset) => sum + asset.currentValue, 0);
}

/**
 * Whether the player currently knows something of a given kind.
 *
 * Knowledge, not cargo. This reads the information the player holds and asks
 * whether a current, unspent piece exists. It never touches the inventory,
 * occupies no slots, cannot be handed to anyone, and nothing is consumed by
 * asking - checking what you know costs nothing.
 */
export function knowsSomethingAbout(
  context: MissionContext,
  relevance: InformationRelevance,
  districtId: string | undefined,
): boolean {
  return context.knowledge.some((row) => {
    if (row.relevance !== relevance) return false;
    if (districtId && row.districtId !== districtId) return false;
    if (row.usedAt) return false;
    return (
      resolveFreshness(
        { discoveredAt: row.discoveredAt, expiresAt: row.expiresAt, usedAt: row.usedAt },
        context.now,
      ) === 'FERSK'
    );
  });
}

/** Norwegian for one objective, with the names the catalogue does not carry. */
export function objectiveText(objective: MissionObjective): string {
  return describeObjective(objective, {
    district:
      'districtId' in objective && objective.districtId
        ? districtName(objective.districtId)
        : null,
    crime: objective.kind === 'KRIM' ? (findCrime(objective.crimeId)?.name ?? null) : null,
    contact:
      objective.kind === 'PRAT' ? (findContact(objective.contactId)?.name ?? null) : null,
    asset:
      objective.kind === 'BAER'
        ? (findAssetType(objective.assetTypeId)?.name ?? null)
        : null,
  });
}

/* ------------------------------------------------------------------ *
 * Requirements - the doorway
 * ------------------------------------------------------------------ */

/**
 * Checks whether a mission may be taken on.
 *
 * Run when a mission is accepted and again when it is delivered. Accepting is
 * not a ticket: a player who sold the car halfway through has not done the job,
 * and the second check is what makes that true rather than merely intended.
 */
export function evaluateRequirements(
  mission: MissionDefinition,
  context: MissionContext,
): MissionEvaluation {
  const { player } = context;
  const req = mission.requirements;
  const results: ConditionResult[] = [];

  results.push({
    met: player.level >= mission.minLevel,
    label: `Krever nivå ${mission.minLevel}`,
    actual: `Du er nivå ${player.level}`,
  });

  const contactName = findContact(mission.contactId)?.name ?? mission.contactId;
  const trust = context.trustByContact.get(mission.contactId);

  results.push({
    met: trust !== undefined,
    label: `Du må kjenne ${contactName}`,
    actual: trust !== undefined ? 'Dere kjenner hverandre' : 'Dere har ikke møttes',
  });

  if (req.minTrust > 0) {
    results.push({
      met: (trust ?? 0) >= req.minTrust,
      label: `Krever ${trustLabel(req.minTrust)} hos ${contactName}`,
      actual:
        trust === undefined
          ? 'Dere har ikke møttes'
          : `Dere er ${trustLabel(trust)} (${trust})`,
    });
  }

  for (const required of mission.requiresMissions) {
    const done = context.completedMissionIds.has(required);
    const name = findMission(required)?.name ?? required;
    results.push({
      met: done,
      label: `Krever at «${name}» er fullført`,
      actual: done ? 'Fullført' : 'Ikke fullført',
    });
  }

  if (req.minCash !== undefined) {
    results.push({
      met: player.cash >= req.minCash,
      label: `Krever ${kr(req.minCash)} i kontanter`,
      actual: `Du har ${kr(player.cash)}`,
    });
  }

  if (req.minBank !== undefined) {
    results.push({
      met: player.bankBalance >= req.minBank,
      label: `Krever ${kr(req.minBank)} på konto`,
      actual: `Du har ${kr(player.bankBalance)}`,
    });
  }

  if (req.maxHeat !== undefined) {
    results.push({
      met: player.heat <= req.maxHeat,
      label: `Heat må være ${req.maxHeat} eller lavere`,
      actual: `Din er ${player.heat}`,
    });
  }

  if (req.ownsAssetTypeId) {
    const name = findAssetType(req.ownsAssetTypeId)?.name ?? req.ownsAssetTypeId;
    const owns = context.assets.some((a) => a.assetTypeId === req.ownsAssetTypeId);
    results.push({
      met: owns,
      label: `Krever at du eier ${name.toLowerCase()}`,
      actual: owns ? 'Du eier den' : 'Du eier den ikke',
    });
  }

  if (req.ownsVehicle) {
    const count = context.vehicles.length;
    results.push({
      met: count > 0,
      label: 'Krever at du eier et kjøretøy',
      actual: count > 0 ? `Du eier ${count}` : 'Du eier ingen',
    });
  }

  if (req.ownsBusinessCount !== undefined) {
    const count = context.businessDistrictIds.length;
    results.push({
      met: count >= req.ownsBusinessCount,
      label: `Krever ${req.ownsBusinessCount} virksomheter`,
      actual: `Du har ${count}`,
    });
  }

  if (req.minSkill) {
    // Read from the same rows the skill screen spends points into: there is no
    // second progression, and a mission can never grant or consume a point.
    const trained = context.skillLevels[req.minSkill.skillId] ?? 0;
    const name = findSkill(req.minSkill.skillId)?.name ?? req.minSkill.skillId;
    results.push({
      met: trained >= req.minSkill.level,
      label: `Krever ${name} på nivå ${req.minSkill.level}`,
      actual: trained > 0 ? `Din er nivå ${trained}` : `Du har ikke trent ${name.toLowerCase()}`,
    });
  }

  if (req.ownsPropertyCount !== undefined) {
    const count = context.propertyDistrictIds.length;
    results.push({
      met: count >= req.ownsPropertyCount,
      label: `Krever ${req.ownsPropertyCount} eiendommer`,
      actual: `Du har ${count}`,
    });
  }

  const blocked = results.find((result) => !result.met);

  return {
    conditions: results,
    eligible: blocked === undefined,
    blockedReason: blocked ? `${blocked.label}. ${blocked.actual}.` : null,
  };
}

/* ------------------------------------------------------------------ *
 * Objectives - the work
 * ------------------------------------------------------------------ */

/**
 * Evaluates one objective.
 *
 * Event objectives read the counter the services have been advancing; state
 * objectives read the world as it stands right now. Both report `current` and
 * `target` so the interface can render one uniform "x av y" without knowing
 * which family an objective belongs to.
 */
function evaluateObjective(
  objective: MissionObjective,
  context: MissionContext,
  progressCount: number,
): ObjectiveResult {
  const label = objectiveText(objective);
  const target = objectiveTarget(objective);

  if (isEventObjective(objective)) {
    const current = Math.min(progressCount, target);
    return {
      kind: objective.kind,
      met: progressCount >= target,
      label,
      actual:
        objective.kind === 'INNSKUDD'
          ? `${kr(current)} av ${kr(target)}`
          : `${current} av ${target}`,
      current,
      target,
    };
  }

  const { player } = context;

  switch (objective.kind) {
    case 'BAER': {
      const name = findAssetType(objective.assetTypeId)?.name ?? objective.assetTypeId;
      const has = carried(context).some((a) => a.assetTypeId === objective.assetTypeId);
      const owned = context.assets.some((a) => a.assetTypeId === objective.assetTypeId);
      return {
        kind: objective.kind,
        met: has,
        label,
        // "Du eier den, men bærer den ikke" is the difference between a
        // shopping trip and a packing mistake, and worth saying out loud.
        actual: has
          ? `Du bærer ${name.toLowerCase()}`
          : owned
            ? 'Du eier den, men bærer den ikke'
            : 'Du eier den ikke',
        current: has ? 1 : 0,
        target: 1,
      };
    }

    case 'VERDI_BAERES': {
      const value = carriedValue(context);
      return {
        kind: objective.kind,
        met: value >= objective.minValue,
        label,
        actual: `Du bærer verdisaker for ${kr(value)}`,
        current: Math.min(value, objective.minValue),
        target: objective.minValue,
      };
    }

    case 'EIE_KJORETOY': {
      const matches = context.vehicles.filter((vehicle) => {
        if (objective.vehicleTypeIds && !objective.vehicleTypeIds.includes(vehicle.vehicleTypeId)) {
          return false;
        }
        if (objective.districtId && vehicle.districtId !== objective.districtId) return false;
        if (objective.minCondition !== undefined && vehicle.condition < objective.minCondition) {
          return false;
        }
        return true;
      });

      const met = matches.length > 0;
      // Naming where the cars actually are turns "nei" into a direction.
      const elsewhere = context.vehicles
        .map((vehicle) => districtName(vehicle.districtId))
        .join(', ');

      return {
        kind: objective.kind,
        met,
        label,
        actual: met
          ? 'Kjøretøyet står klart'
          : context.vehicles.length === 0
            ? 'Du eier ingen kjøretøy'
            : `Kjøretøyene dine står i ${elsewhere}`,
        current: met ? 1 : 0,
        target: 1,
      };
    }

    case 'EIE_VIRKSOMHET': {
      const count = objective.districtId
        ? context.businessDistrictIds.filter((id) => id === objective.districtId).length
        : context.businessDistrictIds.length;
      return {
        kind: objective.kind,
        met: count >= objective.count,
        label,
        actual: `Du har ${count}`,
        current: Math.min(count, objective.count),
        target: objective.count,
      };
    }

    case 'EIE_EIENDOM': {
      const count = objective.districtId
        ? context.propertyDistrictIds.filter((id) => id === objective.districtId).length
        : context.propertyDistrictIds.length;
      return {
        kind: objective.kind,
        met: count >= objective.count,
        label,
        actual: `Du har ${count}`,
        current: Math.min(count, objective.count),
        target: objective.count,
      };
    }

    case 'BANK':
      return {
        kind: objective.kind,
        met: player.bankBalance >= objective.amount,
        label,
        actual: `Du har ${kr(player.bankBalance)} på konto`,
        current: Math.min(player.bankBalance, objective.amount),
        target: objective.amount,
      };

    case 'KONTANTER':
      return {
        kind: objective.kind,
        met: player.cash >= objective.amount,
        label,
        actual: `Du har ${kr(player.cash)} i kontanter`,
        current: Math.min(player.cash, objective.amount),
        target: objective.amount,
      };

    case 'HEAT_UNDER':
      return {
        kind: objective.kind,
        met: player.heat <= objective.maxHeat,
        label,
        actual: `Din heat er ${player.heat}`,
        current: player.heat <= objective.maxHeat ? 1 : 0,
        target: 1,
      };

    case 'KUNNSKAP': {
      const knows = knowsSomethingAbout(context, objective.relevance, objective.districtId);
      return {
        kind: objective.kind,
        met: knows,
        label,
        actual: knows ? 'Du vet det du trenger' : 'Du mangler fersk informasjon',
        current: knows ? 1 : 0,
        target: 1,
      };
    }

    case 'VAER_I': {
      const here = player.currentDistrictId === objective.districtId;
      return {
        kind: objective.kind,
        met: here,
        label,
        actual: `Du er i ${districtName(player.currentDistrictId)}`,
        current: here ? 1 : 0,
        target: 1,
      };
    }

    default:
      // Unreachable while the union is exhaustive; a new kind must not silently
      // count as finished.
      return { kind: 'UKJENT', met: false, label, actual: 'Ukjent mål', current: 0, target: 1 };
  }
}

/** Every objective of a mission, against the world as it stands. */
export function evaluateObjectives(
  mission: MissionDefinition,
  context: MissionContext,
  progressCount: number,
): ObjectiveEvaluation {
  const objectives = mission.objectives.map((objective) =>
    evaluateObjective(objective, context, progressCount),
  );

  const missing = objectives.find((objective) => !objective.met);

  return {
    objectives,
    complete: missing === undefined,
    missingReason: missing ? `${missing.label}. ${missing.actual}.` : null,
  };
}
