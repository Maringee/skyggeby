/** Categories of money movement. Mirrors the Prisma `TransactionType` enum. */
export const TRANSACTION_TYPES = [
  'STARTKAPITAL',
  'BANK_INNSKUDD',
  'BANK_UTTAK',
  'BANK_GEBYR',
  'OVERFORING_INN',
  'OVERFORING_UT',
  'INNTEKT',
  'UTGIFT',
  'EIENDEL_KJOP',
  'EIENDEL_SALG',
  'VIRKSOMHET_KJOP',
  'VIRKSOMHET_UTTAK',
  'EIENDOM_KJOP',
  'EIENDOM_SALG',
  'KORREKSJON',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Which balance a transaction touched. */
export const LEDGERS = ['CASH', 'BANK'] as const;
export type Ledger = (typeof LEDGERS)[number];

/** Norwegian display labels for transaction types. */
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  STARTKAPITAL: 'Startkapital',
  BANK_INNSKUDD: 'Innskudd',
  BANK_UTTAK: 'Uttak',
  BANK_GEBYR: 'Bankgebyr',
  OVERFORING_INN: 'Overføring inn',
  OVERFORING_UT: 'Overføring ut',
  INNTEKT: 'Inntekt',
  UTGIFT: 'Utgift',
  EIENDEL_KJOP: 'Kjøp av eiendel',
  EIENDEL_SALG: 'Salg av eiendel',
  VIRKSOMHET_KJOP: 'Kjøp av virksomhet',
  VIRKSOMHET_UTTAK: 'Uttak fra virksomhet',
  EIENDOM_KJOP: 'Eiendom kjøpt',
  EIENDOM_SALG: 'Eiendom solgt',
  KORREKSJON: 'Korreksjon',
};

export const LEDGER_LABELS: Record<Ledger, string> = {
  CASH: 'Kontanter',
  BANK: 'Bank',
};

/** Public player payload. Never contains the password hash. */
export interface PlayerDto {
  id: string;
  username: string;
  cash: number;
  bankBalance: number;
  health: number;
  reputation: number;
  heat: number;
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForLevel: number;
  energy: number;
  maxEnergy: number;
  /** Id of the district the player is currently in. */
  currentDistrictId: string;
  /** Unspent skill points. Granted by levelling, spent on specialisation. */
  skillPoints: number;
  /** When energy was last settled server side. Used to render a live bar. */
  energyUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionDto {
  id: string;
  amount: number;
  type: TransactionType;
  ledger: Ledger;
  source: string;
  description: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface AuthResponse {
  player: PlayerDto;
}

export interface MeResponse {
  player: PlayerDto;
}

export interface TransactionListResponse {
  transactions: TransactionDto[];
  nextCursor: string | null;
}

export interface BankActionResponse {
  player: PlayerDto;
  transactions: TransactionDto[];
  message: string;
}

/** Uniform error shape returned by every API endpoint. */
export interface ApiErrorBody {
  error: {
    code: string;
    /** Human readable message, always Norwegian (bokmål). */
    message: string;
    fields?: Record<string, string>;
  };
}

export interface RegisterPayload {
  username: string;
  password: string;
  confirmPassword: string;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface BankPayload {
  amount: number;
}

/* ------------------------------------------------------------------ *
 * City
 * ------------------------------------------------------------------ */

/** One district as it looks for this player, right now. */
export interface DistrictStateDto {
  id: string;
  name: string;
  description: string;
  tagline: string;
  policePresence: number;
  risk: number;
  activity: number;
  policeLabel: string;
  riskLabel: string;
  activityLabel: string;
  position: { x: number; y: number };
  /** Norwegian one-liners describing the district's gameplay effect. */
  effects: string[];
  /** True for the district the player is standing in. */
  current: boolean;
}

export interface CityStateResponse {
  districts: DistrictStateDto[];
  currentDistrictId: string;
  player: PlayerDto;
}

export interface MoveResponse {
  player: PlayerDto;
  districts: DistrictStateDto[];
  currentDistrictId: string;
  /** Norwegian confirmation shown to the player. */
  message: string;
  /** False when the player already stood there. */
  moved: boolean;
}

export interface MovePayload {
  districtId: string;
}

/* ------------------------------------------------------------------ *
 * Assets
 * ------------------------------------------------------------------ */

/**
 * One owned asset, as the player sees it.
 *
 * Built explicitly rather than handed straight from the database row, so a new
 * column never leaks into the API by accident. `id` is carried only because the
 * sell action needs to name it - the UI never shows it.
 */
export interface AssetDto {
  id: string;
  assetTypeId: string;
  name: string;
  description: string;
  category: string;
  categoryLabel: string;
  purchasePrice: number;
  currentValue: number;
  /** What the server would pay for it right now. */
  saleValue: number;
  condition: number;
  maintenanceCostPerDay: number;
  visibility: number;
  visibilityLabel: string;
  risk: number;
  riskLabel: string;
  /** District the asset sits in. */
  locationId: string;
  locationName: string;
  status: string;
  statusLabel: string;
  /** Whether the asset is carried in the inventory. */
  storage: string;
  storageLabel: string;
  canSell: boolean;
  /** Norwegian reason the sell button is disabled, or null. */
  blockedText: string | null;
  purchasedAt: string;
}

/** One entry in the buyable catalogue. */
export interface AssetCatalogEntryDto {
  id: string;
  name: string;
  description: string;
  category: string;
  categoryLabel: string;
  purchasePrice: number;
  maintenanceCostPerDay: number;
  visibility: number;
  visibilityLabel: string;
  risk: number;
  riskLabel: string;
  /** Whether the player can afford one right now. */
  affordable: boolean;
}

export interface AssetListResponse {
  assets: AssetDto[];
  /** Combined current value of everything owned. */
  totalValue: number;
  /** What the whole portfolio would fetch if sold today. */
  totalSaleValue: number;
  count: number;
  player: PlayerDto;
}

export interface AssetCatalogResponse {
  catalog: AssetCatalogEntryDto[];
  player: PlayerDto;
}

export interface AssetBuyResponse {
  asset: AssetDto;
  assets: AssetDto[];
  player: PlayerDto;
  transactions: TransactionDto[];
  message: string;
}

export interface AssetSellResponse {
  assets: AssetDto[];
  player: PlayerDto;
  transactions: TransactionDto[];
  saleValue: number;
  message: string;
}

export interface AssetBuyPayload {
  assetTypeId: string;
}

export interface AssetSellPayload {
  assetId: string;
}

/* ------------------------------------------------------------------ *
 * Contacts
 * ------------------------------------------------------------------ */

/**
 * One contact as the player sees them.
 *
 * Deliberately has no reliability field: how dependable a person really is is
 * the server's to know, and exposing it would remove the judgement the system
 * exists to create.
 */
export interface ContactDto {
  id: string;
  name: string;
  /** Norwegian role, e.g. "Mekaniker". */
  role: string;
  type: string;
  specialisations: string[];
  districtId: string;
  districtName: string;
  description: string;
  trust: number;
  trustLabel: string;
  /** Norwegian sentence about how the relationship stands. */
  trustDescription: string;
  status: string;
  statusLabel: string;
  canContact: boolean;
  /** Norwegian reason the contact button is disabled, or null. */
  blockedText: string | null;
  discoveredAt: string;
  lastInteractionAt: string | null;
}

export interface ContactListResponse {
  contacts: ContactDto[];
  count: number;
  /** How many people exist in total, so the UI can hint at what is left. */
  totalKnown: number;
}

export interface ContactDetailResponse {
  contact: ContactDto;
}

export interface ContactDiscoverResponse {
  /** Null when nobody new turned up. */
  contact: ContactDto | null;
  found: boolean;
  /** Norwegian description of what happened. */
  message: string;
  contacts: ContactDto[];
  energySpent: number;
  xpGained: number;
  leveledUp: boolean;
  skillPointsGained: number;
  player: PlayerDto;
}

export interface ContactInteractResponse {
  contact: ContactDto;
  contacts: ContactDto[];
  /** Trust gained by this interaction. */
  trustGained: number;
  message: string;
  energySpent: number;
  xpGained: number;
  leveledUp: boolean;
  skillPointsGained: number;
  player: PlayerDto;
}

export interface ContactPayload {
  contactId: string;
}

/* ------------------------------------------------------------------ *
 * Property
 * ------------------------------------------------------------------ */

/**
 * One owned property as the player sees it.
 *
 * `districtId` is the property's own address, which is not where the player is
 * standing. Every number here is read from the row, not from the catalogue, so
 * a later rebalancing cannot change what an owned place is worth.
 */
export interface PropertyDto {
  id: string;
  /** The name the player gave it. */
  name: string;
  propertyTypeId: string;
  /** Catalogue name, e.g. "Moderne villa". Shown under the player's own name. */
  typeName: string;
  description: string;
  districtId: string;
  districtName: string;
  purchasePrice: number;
  /** Purchase price scaled by condition. */
  currentValue: number;
  /** What the server would pay for it right now. */
  saleValue: number;
  condition: number;
  storageCapacity: number;
  security: number;
  /** Norwegian label, e.g. "Svært høy". */
  securityLabel: string;
  purchasedAt: string;
}

/** One catalogue entry, with affordability resolved by the server. */
export interface PropertyCatalogEntryDto {
  id: string;
  name: string;
  description: string;
  districtId: string;
  districtName: string;
  purchasePrice: number;
  storageCapacity: number;
  security: number;
  securityLabel: string;
  condition: number;
  affordable: boolean;
}

export interface PropertyListResponse {
  properties: PropertyDto[];
  count: number;
  maxProperties: number;
  /** Sum of the current values, for the overview. */
  totalValue: number;
}

export interface PropertyDetailResponse {
  property: PropertyDto;
}

export interface PropertyCatalogResponse {
  catalog: PropertyCatalogEntryDto[];
  count: number;
  maxProperties: number;
  player: PlayerDto;
}

export interface PropertyBuyResponse {
  property: PropertyDto;
  properties: PropertyDto[];
  player: PlayerDto;
  transactions: TransactionDto[];
  message: string;
}

export interface PropertySellResponse {
  properties: PropertyDto[];
  player: PlayerDto;
  transactions: TransactionDto[];
  saleValue: number;
  message: string;
}

export interface PropertyBuyPayload {
  propertyTypeId: string;
  name: string;
}

export interface PropertyPayload {
  propertyId: string;
}

/* ------------------------------------------------------------------ *
 * Vehicles
 * ------------------------------------------------------------------ */

/**
 * One owned vehicle as the player sees it.
 *
 * `districtId` is the vehicle's own location, which is not the player's. The
 * two are separate states on purpose, and `reachable` is the server's answer to
 * "can I do anything with this from where I am standing".
 */
export interface VehicleDto {
  id: string;
  /** The name the player gave it. */
  name: string;
  vehicleTypeId: string;
  /** Catalogue name, e.g. "Sportsbil". Shown under the player's own name. */
  typeName: string;
  description: string;
  /** Where the vehicle is. Never automatically the player's district. */
  districtId: string;
  districtName: string;
  isActive: boolean;
  /** Norwegian label: "Aktiv" or "Parkert". */
  statusLabel: string;
  /** True when the vehicle stands where the player stands. */
  reachable: boolean;
  /** Norwegian reason it cannot be driven right now, or null. */
  blockedText: string | null;
  purchasePrice: number;
  /** What it would sell for right now, from the asset. */
  saleValue: number;
  condition: number;
  visibility: number;
  risk: number;
  riskLabel: string;
  purchasedAt: string;
}

/** One catalogue entry, with affordability resolved by the server. */
export interface VehicleCatalogEntryDto {
  id: string;
  name: string;
  description: string;
  purchasePrice: number;
  visibility: number;
  visibilityLabel: string;
  risk: number;
  riskLabel: string;
  affordable: boolean;
}

export interface VehicleListResponse {
  vehicles: VehicleDto[];
  /** The active vehicle, or null. Also present in `vehicles`. */
  active: VehicleDto | null;
  count: number;
  maxVehicles: number;
  /** Where the player is standing, so the page can explain the geography. */
  playerDistrictId: string;
  playerDistrictName: string;
}

export interface VehicleDetailResponse {
  vehicle: VehicleDto;
}

export interface VehicleCatalogResponse {
  catalog: VehicleCatalogEntryDto[];
  count: number;
  maxVehicles: number;
  player: PlayerDto;
}

export interface VehicleActionResponse {
  vehicle: VehicleDto;
  vehicles: VehicleDto[];
  active: VehicleDto | null;
  message: string;
}

export interface VehicleBuyResponse extends VehicleActionResponse {
  player: PlayerDto;
  transactions: TransactionDto[];
}

export interface VehicleSellResponse {
  vehicles: VehicleDto[];
  active: VehicleDto | null;
  player: PlayerDto;
  transactions: TransactionDto[];
  saleValue: number;
  message: string;
}

export interface VehicleBuyPayload {
  vehicleTypeId: string;
  name: string;
}

export interface VehiclePayload {
  vehicleId: string;
}

export interface VehicleMovePayload {
  vehicleId: string;
  destinationDistrictId: string;
}

/* ------------------------------------------------------------------ *
 * Player profiles
 * ------------------------------------------------------------------ */

/** Search input limits, shared so the client stops before the server has to. */
export const PLAYER_SEARCH = {
  minLength: 2,
  maxLength: 30,
  maxResults: 10,
} as const;

/**
 * One player as everybody else is allowed to see them.
 *
 * Deliberately built field by field rather than derived from `PlayerDto`:
 * money, health, heat and skill points are the player's own business, and a
 * separate type is what makes it impossible to widen this view by accident.
 *
 * The id is opaque and carries no access of its own - every private endpoint is
 * scoped to the session, never to an id in a request.
 */
export interface PublicProfileDto {
  id: string;
  username: string;
  level: number;
  /** Total experience. Progress within the level stays private. */
  xp: number;
  reputation: number;
  reputationLabel: string;
  districtId: string;
  districtName: string;
  /** When the account was created. */
  memberSince: string;
  businessCount: number;
  assetCount: number;
  /** True when the viewer is looking at themselves. */
  isSelf: boolean;
}

export interface PublicProfileResponse {
  profile: PublicProfileDto;
}

/** One row in a player search. The same narrow view as a public profile. */
export interface PlayerSearchResultDto {
  id: string;
  username: string;
  level: number;
  reputation: number;
  districtId: string;
  districtName: string;
}

export interface PlayerSearchResponse {
  players: PlayerSearchResultDto[];
  count: number;
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

/** Tuning for the message system. Shared so client and server agree. */
export const MESSAGE_LIMITS = {
  subjectMin: 1,
  subjectMax: 100,
  contentMin: 1,
  contentMax: 5000,
  /** Page size for the inbox and the sent box. */
  pageSize: 25,
  maxPageSize: 50,
  /** Characters of the body shown in a list row. */
  previewLength: 140,
} as const;

/** Which box a listing is for. */
export const MESSAGE_BOXES = ['innboks', 'sendt'] as const;
export type MessageBox = (typeof MESSAGE_BOXES)[number];

/**
 * The other party in a message, as far as the player is allowed to know them.
 *
 * Deliberately just an id and a name: a message must never become a way to
 * read someone else's cash, level or position.
 */
export interface MessageParticipantDto {
  id: string;
  username: string;
}

/**
 * One message in a list.
 *
 * Carries a short preview rather than the whole body, so opening the inbox does
 * not ship twenty-five 5 000-character messages the player has not asked for.
 */
export interface MessageSummaryDto {
  id: string;
  subject: string;
  /** First few characters of the body, for the list row. */
  preview: string;
  sender: MessageParticipantDto;
  recipient: MessageParticipantDto;
  /** Whether this row is incoming or outgoing, seen from the viewer. */
  direction: 'INN' | 'UT';
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

/** One message opened in full. */
export interface MessageDto extends MessageSummaryDto {
  content: string;
}

export interface MessageListResponse {
  messages: MessageSummaryDto[];
  box: MessageBox;
  /** Pass back as `cursor` to fetch the next page. Null when at the end. */
  nextCursor: string | null;
  count: number;
  /** Unread count, so the badge stays right after any listing. */
  unread: number;
}

export interface MessageDetailResponse {
  message: MessageDto;
  unread: number;
}

export interface MessageSendResponse {
  sent: MessageDto;
  /** Norwegian confirmation. */
  message: string;
}

export interface MessageReadResponse {
  read: MessageDto;
  message: string;
  unread: number;
}

export interface MessageDeleteResponse {
  message: string;
  unread: number;
}

export interface UnreadCountResponse {
  count: number;
}

export interface MessageRecipientsResponse {
  players: MessageParticipantDto[];
}

export interface MessageSendPayload {
  recipientId: string;
  subject: string;
  content: string;
}

/* ------------------------------------------------------------------ *
 * Businesses
 * ------------------------------------------------------------------ */

/**
 * One owned business as the player sees it.
 *
 * Written out field by field in the serialiser rather than spread from the row,
 * so a column added later cannot leak into the API by accident. The rates come
 * from the server's catalogue, never from the client.
 */
export interface BusinessDto {
  id: string;
  /** The name the player gave it. */
  name: string;
  businessTypeId: string;
  /** Catalogue name, e.g. "Verksted". Shown alongside the player's own name. */
  typeName: string;
  districtId: string;
  districtName: string;
  /** Kroner waiting on the business account. */
  cashBalance: number;
  condition: number;
  activity: number;
  risk: number;
  /** Norwegian risk label, e.g. "Middels". */
  riskLabel: string;
  incomePerDay: number;
  operatingCostPerDay: number;
  netIncomePerDay: number;
  /** Display estimate: purchase price scaled by condition. */
  estimatedValue: number;
  lastSettlementAt: string;
  purchasedAt: string;
}

/** One catalogue entry, with affordability resolved by the server. */
export interface BusinessCatalogEntryDto {
  id: string;
  name: string;
  description: string;
  districtId: string;
  districtName: string;
  purchasePrice: number;
  incomePerDay: number;
  operatingCostPerDay: number;
  netIncomePerDay: number;
  risk: number;
  riskLabel: string;
  activity: number;
  condition: number;
  affordable: boolean;
}

export interface BusinessListResponse {
  businesses: BusinessDto[];
  count: number;
  maxBusinesses: number;
  /** Sum of the display estimates, not of the business accounts. */
  totalValue: number;
  /** Kroner credited to the accounts by the settlement this request ran. */
  earned: number;
}

export interface BusinessDetailResponse {
  business: BusinessDto;
  earned: number;
}

export interface BusinessCatalogResponse {
  catalog: BusinessCatalogEntryDto[];
  /** How many the player already owns. */
  count: number;
  maxBusinesses: number;
  player: PlayerDto;
}

export interface BusinessBuyResponse {
  business: BusinessDto;
  businesses: BusinessDto[];
  player: PlayerDto;
  transactions: TransactionDto[];
  message: string;
}

export interface BusinessWithdrawResponse {
  business: BusinessDto;
  businesses: BusinessDto[];
  player: PlayerDto;
  transactions: TransactionDto[];
  /** Kroner moved to the player. */
  amount: number;
  message: string;
}

export interface BusinessBuyPayload {
  businessTypeId: string;
  name: string;
}

export interface BusinessWithdrawPayload {
  businessId: string;
}

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

/**
 * One asset as it appears on the inventory page.
 *
 * Leaner than `AssetDto` on purpose: this view is about carrying, so prices and
 * timestamps that belong to the assets page are left out.
 */
export interface InventoryItemDto {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  condition: number;
  /** Slots it occupies when carried. */
  inventorySlots: number;
  /** District the asset is in. Carrying never moves it. */
  locationId: string;
  locationName: string;
  status: string;
  statusLabel: string;
  storage: string;
  storageLabel: string;
  visibility: number;
  risk: number;
  /** True when the player could put this in the inventory right now. */
  canAdd: boolean;
  /** Norwegian reason it cannot be added, or null. */
  blockedText: string | null;
}

export interface InventoryResponse {
  /** Assets currently carried. */
  items: InventoryItemDto[];
  /** Assets owned but not carried. */
  stored: InventoryItemDto[];
  usedSlots: number;
  capacity: number;
  remainingSlots: number;
}

export interface InventoryActionResponse extends InventoryResponse {
  /** Norwegian confirmation. */
  message: string;
}

export interface InventoryPayload {
  assetId: string;
}

/* ------------------------------------------------------------------ *
 * Skills
 * ------------------------------------------------------------------ */

/**
 * One skill as the player sees it.
 *
 * Effects arrive as finished Norwegian sentences and numbers the server has
 * already computed. The formula itself stays on the server - the client renders
 * what it is told, and owns no gameplay maths.
 */
export interface SkillDto {
  id: string;
  name: string;
  description: string;
  focus: string;
  level: number;
  maxLevel: number;
  /** 0..1 toward the maximum level. */
  progress: number;
  /** What the skill gives right now, in Norwegian. */
  currentEffect: string;
  /** What one more level would give, or null at max. */
  nextEffect: string | null;
  /** True when no system consumes this skill yet. */
  dormant: boolean;
  atMax: boolean;
  canUpgrade: boolean;
  /** Norwegian reason the upgrade button is disabled, or null. */
  blockedText: string | null;
}

export interface SkillListResponse {
  skills: SkillDto[];
  skillPoints: number;
  upgradeCost: number;
  player: PlayerDto;
}

export interface SkillUpgradeResponse {
  /** The skill that was raised. */
  skill: SkillDto;
  skills: SkillDto[];
  skillPoints: number;
  player: PlayerDto;
  /** Norwegian confirmation. */
  message: string;
}

export interface SkillUpgradePayload {
  skillId: string;
}

/* ------------------------------------------------------------------ *
 * Information
 * ------------------------------------------------------------------ */

/**
 * One piece of information as the player sees it.
 *
 * Deliberately has no truth flag: whether the information is actually correct
 * is server-only state, and exposing it would remove the entire decision the
 * system exists to create.
 */
export interface InformationDto {
  id: string;
  type: string;
  typeLabel: string;
  source: string;
  sourceLabel: string;
  relevance: string;
  relevanceLabel: string;
  title: string;
  content: string;
  /** Null when the information is not tied to one district. */
  districtId: string | null;
  districtName: string | null;
  /** Stated confidence, 0-100. Decided by the server. */
  reliability: number;
  freshness: string;
  freshnessLabel: string;
  /** Worth at discovery, before ageing. */
  baseValue: number;
  /** Worth right now, after ageing. */
  currentValue: number;
  /** Percentage points this would add to a relevant job right now. */
  potentialBonus: number;
  /** Norwegian names of the jobs this could help with. */
  helpsWith: string[];
  discoveredAt: string;
  lastConfirmedAt: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  used: boolean;
}

export interface InformationListResponse {
  information: InformationDto[];
  /** Seconds until the player may explore again, 0 when ready. */
  exploreCooldownSeconds: number;
  exploreEnergyCost: number;
  player: PlayerDto;
  districtId: string;
  districtName: string;
}

export interface ExploreResponse {
  /** Null when the search turned up nothing. */
  found: InformationDto | null;
  /** Norwegian description of what happened. */
  message: string;
  energySpent: number;
  /** Experience for the round, paid whether or not anything was found. */
  xpGained: number;
  leveledUp: boolean;
  skillPointsGained: number;
  exploreCooldownSeconds: number;
  player: PlayerDto;
  information: InformationDto[];
}

/* ------------------------------------------------------------------ *
 * Crime
 * ------------------------------------------------------------------ */

/** Why a crime cannot be attempted right now. */
export type CrimeBlockedReason =
  | 'NIVA'
  | 'ENERGI'
  | 'AVKJOLING'
  | 'HELSE';

/** One crime as it looks for this specific player, right now. */
export interface CrimeStateDto {
  id: string;
  name: string;
  description: string;
  /** Flavour name of the spot, not a city district. */
  scene: string;
  minLevel: number;
  energyCost: number;
  cooldownSeconds: number;
  /** Base chance from the balance table, 0..1. */
  baseSuccessChance: number;
  /** Chance after the player's heat is taken into account, 0..1. */
  successChance: number;
  riskLabel: string;
  rewardMin: number;
  rewardMax: number;
  xpMin: number;
  xpMax: number;
  unlocked: boolean;
  available: boolean;
  blockedReason: CrimeBlockedReason | null;
  /** Norwegian explanation of why the button is disabled. */
  blockedText: string | null;
  cooldownRemainingSeconds: number;
  /** ISO timestamp for when the cooldown ends, or null. */
  cooldownUntil: string | null;
}

/** Crime list plus the district those numbers already account for. */
export interface CrimeListResponseMeta {
  districtId: string;
  districtName: string;
}

export interface CrimeOutcomeDto {
  crimeId: string;
  crimeName: string;
  /** Where the job was carried out, resolved server side. */
  districtId: string;
  districtName: string;
  success: boolean;
  /** Norwegian narrative describing what happened. */
  story: string;
  /** Norwegian headline, e.g. "Vellykket" or "Mislyktes". */
  headline: string;
  payout: number;
  fine: number;
  xpGained: number;
  heatChange: number;
  healthChange: number;
  energySpent: number;
  leveledUp: boolean;
  newLevel: number;
  /** Skill points granted by this attempt's level-ups. */
  skillPointsGained: number;
  cooldownSeconds: number;
  cooldownUntil: string;
  performedAt: string;
  /** Information consumed by this job, if any. */
  information: UsedInformationDto | null;
}

/** What a job did with a piece of information the player held. */
export interface UsedInformationDto {
  id: string;
  title: string;
  type: string;
  typeLabel: string;
  /** Percentage points it actually contributed. Zero when it did not hold up. */
  bonusApplied: number;
  /** Norwegian note about how useful it turned out to be. */
  note: string;
}

export interface CrimeListResponse {
  crimes: CrimeStateDto[];
  player: PlayerDto;
  district: CrimeListResponseMeta;
}

export interface CrimeActionResponse {
  outcome: CrimeOutcomeDto;
  player: PlayerDto;
  transactions: TransactionDto[];
  crimes: CrimeStateDto[];
  district: CrimeListResponseMeta;
}
