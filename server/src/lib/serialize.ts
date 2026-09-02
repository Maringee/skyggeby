import type {
  Asset,
  Business,
  Property,
  ContactRelationship,
  Information,
  Player,
  Transaction,
} from '@prisma/client';
import {
  MESSAGE_LIMITS,
  calculatePropertySaleValue,
  findPropertyType,
  propertySecurityLabel,
  isReachable,
  vehicleStatusLabel,
  reputationLabel,
  BUSINESS_TUNING,
  businessRiskLabel,
  calculateBusinessValue,
  findBusinessType,
  netIncomePerDay,
  CONTACT_STATUS_BLOCK_REASONS,
  CONTACT_STATUS_LABELS,
  canContactStatus,
  findContact,
  findContactType,
  trustLevel,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_BLOCK_REASONS,
  ASSET_STATUS_LABELS,
  ASSET_CARRY_BLOCK_REASONS,
  ASSET_STORAGE_LABELS,
  assetRiskLabel,
  canCarryStatus,
  inventorySlotsFor,
  isInventoryEligible,
  calculateSaleValue,
  canSellStatus,
  findAssetType,
  visibilityLabel,
  FRESHNESS_LABELS,
  INFORMATION_RELEVANCE_LABELS,
  INFORMATION_SOURCE_LABELS,
  INFORMATION_TYPE_LABELS,
  crimesHelpedBy,
  formatPoints,
  currentValue,
  informationBonusPoints,
  resolveDistrict,
  resolveFreshness,
  xpRequiredForLevel,
  type CrimeOutcomeDto,
  type BusinessCatalogEntryDto,
  type BusinessDto,
  type MessageDto,
  type MessageParticipantDto,
  type MessageSummaryDto,
  type PlayerSearchResultDto,
  type PublicProfileDto,
  type PropertyCatalogEntryDto,
  type PropertyDto,
  type PropertyTypeDefinition,
  type VehicleCatalogEntryDto,
  type VehicleDto,
  type BusinessTypeDefinition,
  type AssetCatalogEntryDto,
  type AssetCategory,
  type AssetDto,
  type AssetStatus,
  type AssetStorage,
  type ContactDto,
  type ContactStatus,
  type InventoryItemDto,
  type InformationDto,
  type InformationRelevance,
  type InformationSource,
  type InformationType,
  type PlayerDto,
  type TransactionDto,
  type TransactionType,
  type Ledger,
} from '@skyggeby/shared';
import type { CrimeOutcome } from '../modules/crime/crime.service';

/** Strips secrets and adds derived progression values for the UI. */
export function toPlayerDto(player: Player): PlayerDto {
  const floor = xpRequiredForLevel(player.level);
  const ceiling = xpRequiredForLevel(player.level + 1);

  return {
    id: player.id,
    username: player.username,
    cash: player.cash,
    bankBalance: player.bankBalance,
    health: player.health,
    reputation: player.reputation,
    heat: player.heat,
    level: player.level,
    xp: player.xp,
    xpIntoLevel: Math.max(0, player.xp - floor),
    xpForLevel: Math.max(1, ceiling - floor),
    energy: player.energy,
    maxEnergy: player.maxEnergy,
    currentDistrictId: player.currentDistrictId,
    skillPoints: player.skillPoints,
    energyUpdatedAt: player.energyUpdatedAt.toISOString(),
    createdAt: player.createdAt.toISOString(),
    updatedAt: player.updatedAt.toISOString(),
  };
}

export function toTransactionDto(tx: Transaction): TransactionDto {
  return {
    id: tx.id,
    amount: tx.amount,
    type: tx.type as TransactionType,
    ledger: tx.ledger as Ledger,
    source: tx.source,
    description: tx.description,
    balanceAfter: tx.balanceAfter,
    createdAt: tx.createdAt.toISOString(),
  };
}

export function toCrimeOutcomeDto(outcome: CrimeOutcome): CrimeOutcomeDto {
  return {
    crimeId: outcome.crimeId,
    crimeName: outcome.crimeName,
    districtId: outcome.districtId,
    districtName: outcome.districtName,
    success: outcome.success,
    story: outcome.story,
    headline: outcome.headline,
    payout: outcome.payout,
    fine: outcome.fine,
    xpGained: outcome.xpGained,
    heatChange: outcome.heatChange,
    healthChange: outcome.healthChange,
    energySpent: outcome.energySpent,
    leveledUp: outcome.leveledUp,
    newLevel: outcome.newLevel,
    skillPointsGained: outcome.skillPointsGained,
    cooldownSeconds: outcome.cooldownSeconds,
    cooldownUntil: outcome.cooldownUntil.toISOString(),
    performedAt: outcome.performedAt.toISOString(),
    information: outcome.information
      ? {
          id: outcome.information.information.id,
          title: outcome.information.information.title,
          type: outcome.information.information.type,
          typeLabel:
            INFORMATION_TYPE_LABELS[outcome.information.information.type as InformationType],
          bonusApplied: outcome.information.bonusPoints,
          // Whether the tip held up is revealed only after it is spent - that
          // is the payoff for the risk, not a leak of the stored truth flag.
          note:
            outcome.information.bonusPoints > 0
              ? `Informasjonen stemte og ga deg ${formatPoints(outcome.information.bonusPoints)} prosentpoeng bedre odds.`
              : 'Informasjonen viste seg å ikke stemme. Den er brukt opp.',
        }
      : null,
  };
}

const CRIME_NAMES: Record<string, string> = {
  lommetyveri: 'Lommetyveri',
  butikktyveri: 'Butikktyveri',
  innbrudd: 'Innbrudd',
  bilkapring: 'Bilkapring',
  lagerinnbrudd: 'Lagerinnbrudd',
};

/**
 * Public view of a piece of information.
 *
 * `isTrue` is intentionally not mapped. It is the one field the player must not
 * have, and leaving it out here is what guarantees it never ships - no endpoint
 * can leak what the serialiser does not carry.
 */
export function toInformationDto(row: Information, now: Date = new Date()): InformationDto {
  const type = row.type as InformationType;
  const freshness = resolveFreshness(
    { discoveredAt: row.discoveredAt, expiresAt: row.expiresAt, usedAt: row.usedAt },
    now,
  );

  const district = row.districtId ? resolveDistrict(row.districtId) : null;
  const relevance = row.relevance as InformationRelevance;

  return {
    id: row.id,
    type,
    typeLabel: INFORMATION_TYPE_LABELS[type],
    source: row.source,
    sourceLabel: INFORMATION_SOURCE_LABELS[row.source as InformationSource],
    relevance,
    relevanceLabel: INFORMATION_RELEVANCE_LABELS[relevance],
    title: row.title,
    content: row.content,
    districtId: row.districtId,
    districtName: district?.name ?? null,
    reliability: row.reliability,
    freshness,
    freshnessLabel: FRESHNESS_LABELS[freshness],
    baseValue: row.baseValue,
    currentValue: currentValue(row.baseValue, freshness),
    potentialBonus: informationBonusPoints({
      type,
      reliability: row.reliability,
      freshness,
    }),
    helpsWith: crimesHelpedBy(relevance).map((id) => CRIME_NAMES[id] ?? id),
    discoveredAt: row.discoveredAt.toISOString(),
    lastConfirmedAt: row.lastConfirmedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    usedAt: row.usedAt?.toISOString() ?? null,
    used: row.usedAt !== null,
  };
}

/**
 * Public view of an owned asset.
 *
 * Written out field by field rather than spreading the row, so a column added
 * later cannot leak into the API without someone deciding it should.
 */
export function toAssetDto(row: Asset): AssetDto {
  const status = row.status as AssetStatus;
  const category = row.category as AssetCategory;
  const definition = findAssetType(row.assetTypeId);
  const district = resolveDistrict(row.location);

  return {
    id: row.id,
    assetTypeId: row.assetTypeId,
    name: row.name,
    description: definition?.description ?? '',
    category,
    categoryLabel: ASSET_CATEGORY_LABELS[category],
    purchasePrice: row.purchasePrice,
    currentValue: row.currentValue,
    saleValue: calculateSaleValue(row.purchasePrice, row.condition),
    condition: row.condition,
    maintenanceCostPerDay: row.maintenanceCostPerDay,
    visibility: row.visibility,
    visibilityLabel: visibilityLabel(row.visibility),
    risk: row.risk,
    riskLabel: assetRiskLabel(row.risk),
    locationId: district.id,
    locationName: district.name,
    status,
    statusLabel: ASSET_STATUS_LABELS[status],
    storage: row.storageLocation,
    storageLabel: ASSET_STORAGE_LABELS[row.storageLocation as AssetStorage],
    canSell: canSellStatus(status),
    blockedText: ASSET_STATUS_BLOCK_REASONS[status],
    purchasedAt: row.purchasedAt.toISOString(),
  };
}

/** One catalogue entry, with affordability resolved against the player. */
export function toAssetCatalogEntryDto(
  definition: NonNullable<ReturnType<typeof findAssetType>>,
  cash: number,
): AssetCatalogEntryDto {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    categoryLabel: ASSET_CATEGORY_LABELS[definition.category],
    purchasePrice: definition.purchasePrice,
    maintenanceCostPerDay: definition.maintenanceCostPerDay,
    visibility: definition.visibility,
    visibilityLabel: visibilityLabel(definition.visibility),
    risk: definition.risk,
    riskLabel: assetRiskLabel(definition.risk),
    affordable: cash >= definition.purchasePrice,
  };
}

/**
 * Public view of an asset on the inventory page.
 *
 * `remainingSlots` is passed in so the server, not the browser, decides whether
 * a thing would fit right now.
 */
export function toInventoryItemDto(row: Asset, remainingSlots: number): InventoryItemDto {
  const status = row.status as AssetStatus;
  const category = row.category as AssetCategory;
  const storage = row.storageLocation as AssetStorage;
  const district = resolveDistrict(row.location);
  const slots = inventorySlotsFor(row.assetTypeId);

  let blockedText: string | null = null;
  if (!isInventoryEligible(row.assetTypeId)) {
    blockedText = 'Denne eiendelen kan ikke bæres.';
  } else if (!canCarryStatus(status)) {
    blockedText = ASSET_CARRY_BLOCK_REASONS[status];
  } else if (storage === 'INVENTORY') {
    blockedText = null;
  } else if (slots > remainingSlots) {
    blockedText = 'Ikke nok plass';
  }

  return {
    id: row.id,
    name: row.name,
    category,
    categoryLabel: ASSET_CATEGORY_LABELS[category],
    condition: row.condition,
    inventorySlots: slots,
    locationId: district.id,
    locationName: district.name,
    status,
    statusLabel: ASSET_STATUS_LABELS[status],
    storage,
    storageLabel: ASSET_STORAGE_LABELS[storage],
    visibility: row.visibility,
    risk: row.risk,
    canAdd: storage !== 'INVENTORY' && blockedText === null,
    blockedText,
  };
}

/**
 * Public view of a contact.
 *
 * `reliability` is intentionally not mapped. How dependable a person really is
 * is server-only state, and leaving it out of the serialiser is what guarantees
 * no endpoint can leak it.
 */
export function toContactDto(row: ContactRelationship): ContactDto {
  const definition = findContact(row.contactId);
  const type = definition ? findContactType(definition.type) : undefined;
  const district = resolveDistrict(definition?.districtId ?? '');
  const status = row.status as ContactStatus;
  const level = trustLevel(row.trust);

  return {
    id: row.contactId,
    name: definition?.name ?? 'Ukjent person',
    role: type?.role ?? 'Ukjent',
    type: definition?.type ?? 'ukjent',
    specialisations: type?.specialisations ?? [],
    districtId: district.id,
    districtName: district.name,
    description: definition?.description ?? '',
    trust: row.trust,
    trustLabel: level.label,
    trustDescription: level.description,
    status,
    statusLabel: CONTACT_STATUS_LABELS[status],
    canContact: canContactStatus(status),
    blockedText: CONTACT_STATUS_BLOCK_REASONS[status],
    discoveredAt: row.discoveredAt.toISOString(),
    lastInteractionAt: row.lastInteractionAt?.toISOString() ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Businesses
 * ------------------------------------------------------------------ */

/**
 * Public view of an owned business.
 *
 * `playerId`, `createdAt` and `updatedAt` are intentionally not mapped: they
 * are bookkeeping, not gameplay, and leaving them out of the serialiser is what
 * guarantees no endpoint hands them out. The rates come from the catalogue, so
 * what the player is shown is exactly what the server settles by.
 */
export function toBusinessDto(row: Business): BusinessDto {
  const definition = findBusinessType(row.businessTypeId);
  const district = resolveDistrict(row.districtId);

  const incomePerDay = definition?.incomePerDay ?? 0;
  const operatingCostPerDay = definition?.operatingCostPerDay ?? 0;

  return {
    id: row.id,
    name: row.name,
    businessTypeId: row.businessTypeId,
    typeName: definition?.name ?? 'Ukjent virksomhet',
    districtId: district.id,
    districtName: district.name,
    cashBalance: row.cashBalance,
    condition: row.condition,
    activity: row.activity,
    risk: row.risk,
    riskLabel: businessRiskLabel(row.risk),
    incomePerDay,
    operatingCostPerDay,
    netIncomePerDay: netIncomePerDay({ incomePerDay, operatingCostPerDay }),
    estimatedValue: calculateBusinessValue(
      definition?.purchasePrice ?? 0,
      row.condition,
    ),
    lastSettlementAt: row.lastSettlementAt.toISOString(),
    purchasedAt: row.purchasedAt.toISOString(),
  };
}

/**
 * One catalogue entry, with affordability and the ownership limit resolved
 * against the player by the server rather than guessed at in the browser.
 */
export function toBusinessCatalogEntryDto(
  definition: BusinessTypeDefinition,
  cash: number,
  owned: number,
): BusinessCatalogEntryDto {
  const district = resolveDistrict(definition.districtId);

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    districtId: district.id,
    districtName: district.name,
    purchasePrice: definition.purchasePrice,
    incomePerDay: definition.incomePerDay,
    operatingCostPerDay: definition.operatingCostPerDay,
    netIncomePerDay: netIncomePerDay(definition),
    risk: definition.risk,
    riskLabel: businessRiskLabel(definition.risk),
    activity: definition.activity,
    condition: definition.condition,
    affordable:
      cash >= definition.purchasePrice && owned < BUSINESS_TUNING.maxBusinesses,
  };
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

/** A message row with its two parties selected down to what may be shown. */
export interface MessageRow {
  id: string;
  subject: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
  sender: MessageParticipantDto;
  recipient: MessageParticipantDto;
}

/** The first line or so of a body, for a list row. */
function preview(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > MESSAGE_LIMITS.previewLength
    ? `${flat.slice(0, MESSAGE_LIMITS.previewLength).trimEnd()}…`
    : flat;
}

/**
 * Public view of a message in a list.
 *
 * The body is deliberately not carried: a listing ships a preview, and the full
 * text only when the player actually opens the message. `senderDeletedAt` and
 * `recipientDeletedAt` are not mapped either - which copy the other party has
 * thrown away is none of the viewer's business.
 */
export function toMessageSummaryDto(row: MessageRow, viewerId: string): MessageSummaryDto {
  return {
    id: row.id,
    subject: row.subject,
    preview: preview(row.content),
    sender: { id: row.sender.id, username: row.sender.username },
    recipient: { id: row.recipient.id, username: row.recipient.username },
    direction: row.recipient.id === viewerId ? 'INN' : 'UT',
    read: row.readAt !== null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Public view of one opened message. Plain text; the client never renders HTML. */
export function toMessageDto(row: MessageRow, viewerId: string): MessageDto {
  return { ...toMessageSummaryDto(row, viewerId), content: row.content };
}

/* ------------------------------------------------------------------ *
 * Player profiles
 * ------------------------------------------------------------------ */

/** The shape a public profile is built from. Nothing private is even loaded. */
export interface PublicProfileSource {
  id: string;
  username: string;
  level: number;
  xp: number;
  reputation: number;
  currentDistrictId: string;
  createdAt: Date;
  _count: { businesses: number; assets: number };
}

/**
 * Public view of a player.
 *
 * Deliberately not derived from `toPlayerDto`: that one carries cash, bank,
 * health, heat and skill points, and reusing it here would put every one of
 * them one forgotten `delete` away from shipping. This builds its own object
 * from an already-narrowed row, so the private fields have no path in.
 *
 * The district name comes from the shared catalogue, never from a request.
 */
export function toPublicProfileDto(
  row: PublicProfileSource,
  viewerId: string,
): PublicProfileDto {
  const district = resolveDistrict(row.currentDistrictId);

  return {
    id: row.id,
    username: row.username,
    level: row.level,
    xp: row.xp,
    reputation: row.reputation,
    reputationLabel: reputationLabel(row.reputation),
    districtId: district.id,
    districtName: district.name,
    memberSince: row.createdAt.toISOString(),
    businessCount: row._count.businesses,
    assetCount: row._count.assets,
    isSelf: row.id === viewerId,
  };
}

/** One search hit. The same narrow view, minus the counts. */
export function toPlayerSearchResultDto(row: {
  id: string;
  username: string;
  level: number;
  reputation: number;
  currentDistrictId: string;
}): PlayerSearchResultDto {
  const district = resolveDistrict(row.currentDistrictId);

  return {
    id: row.id,
    username: row.username,
    level: row.level,
    reputation: row.reputation,
    districtId: district.id,
    districtName: district.name,
  };
}

/* ------------------------------------------------------------------ *
 * Vehicles
 * ------------------------------------------------------------------ */

/** The shape a vehicle DTO is built from: the row plus its asset. */
export interface VehicleSource {
  id: string;
  name: string;
  vehicleTypeId: string;
  locationDistrictId: string;
  isActive: boolean;
  asset: {
    purchasePrice: number;
    condition: number;
    visibility: number;
    risk: number;
    purchasedAt: Date;
  };
}

/**
 * Public view of an owned vehicle.
 *
 * The district here is the *vehicle's*, never the player's - the two are
 * separate states, and `reachable` is the server's answer to whether they
 * happen to coincide right now. Written out field by field, so a column added
 * later cannot leak into the API without someone deciding it should.
 */
export function toVehicleDto(row: VehicleSource, playerDistrictId: string): VehicleDto {
  const definition = findAssetType(row.vehicleTypeId);
  const district = resolveDistrict(row.locationDistrictId);
  const reachable = isReachable(district.id, playerDistrictId);

  return {
    id: row.id,
    name: row.name,
    vehicleTypeId: row.vehicleTypeId,
    typeName: definition?.name ?? 'Ukjent kjøretøy',
    description: definition?.description ?? '',
    districtId: district.id,
    districtName: district.name,
    isActive: row.isActive,
    statusLabel: vehicleStatusLabel(row.isActive),
    reachable,
    blockedText: reachable ? null : 'Kjøretøyet står i et annet distrikt.',
    purchasePrice: row.asset.purchasePrice,
    saleValue: calculateSaleValue(row.asset.purchasePrice, row.asset.condition),
    condition: row.asset.condition,
    visibility: row.asset.visibility,
    risk: row.asset.risk,
    riskLabel: assetRiskLabel(row.asset.risk),
    purchasedAt: row.asset.purchasedAt.toISOString(),
  };
}

/** One catalogue entry, with affordability resolved against the player. */
export function toVehicleCatalogEntryDto(
  definition: NonNullable<ReturnType<typeof findAssetType>>,
  cash: number,
  owned: number,
  maxVehicles: number,
): VehicleCatalogEntryDto {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    purchasePrice: definition.purchasePrice,
    visibility: definition.visibility,
    visibilityLabel: visibilityLabel(definition.visibility),
    risk: definition.risk,
    riskLabel: assetRiskLabel(definition.risk),
    affordable: cash >= definition.purchasePrice && owned < maxVehicles,
  };
}

/* ------------------------------------------------------------------ *
 * Property
 * ------------------------------------------------------------------ */

/**
 * Public view of an owned property.
 *
 * Every number comes from the row, not from the catalogue: the price that was
 * paid, the value derived from it and the sale value are all history, and a
 * later rebalancing must not rewrite them. `playerId` and `updatedAt` are
 * intentionally not mapped - they are bookkeeping, not gameplay.
 */
export function toPropertyDto(row: Property): PropertyDto {
  const definition = findPropertyType(row.propertyTypeId);
  const district = resolveDistrict(row.districtId);

  return {
    id: row.id,
    name: row.name,
    propertyTypeId: row.propertyTypeId,
    typeName: definition?.name ?? 'Ukjent eiendom',
    description: definition?.description ?? '',
    districtId: district.id,
    districtName: district.name,
    purchasePrice: row.purchasePrice,
    currentValue: row.currentValue,
    saleValue: calculatePropertySaleValue(row.purchasePrice, row.condition),
    condition: row.condition,
    storageCapacity: row.storageCapacity,
    security: row.security,
    securityLabel: propertySecurityLabel(row.security),
    purchasedAt: row.purchasedAt.toISOString(),
  };
}

/**
 * One catalogue entry, with affordability and the ownership limit resolved
 * against the player by the server rather than guessed at in the browser.
 */
export function toPropertyCatalogEntryDto(
  definition: PropertyTypeDefinition,
  cash: number,
  owned: number,
  maxProperties: number,
): PropertyCatalogEntryDto {
  const district = resolveDistrict(definition.districtId);

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    districtId: district.id,
    districtName: district.name,
    purchasePrice: definition.purchasePrice,
    storageCapacity: definition.storageCapacity,
    security: definition.security,
    securityLabel: propertySecurityLabel(definition.security),
    condition: definition.condition,
    affordable: cash >= definition.purchasePrice && owned < maxProperties,
  };
}
