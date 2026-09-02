/**
 * Assets — things a player owns.
 *
 * The catalogue lives here, alongside districts and crimes, so adding an asset
 * type is one entry and no migration. Prices, wear and worth are all decided by
 * the server from this table; a client never sends a number that becomes money.
 *
 * v1 is deliberately inert: an asset costs money, holds value and can be sold.
 * Nothing here grants a gameplay bonus, and nothing charges maintenance yet.
 */

export const ASSET_CATEGORIES = [
  'VEHICLE',
  'EQUIPMENT',
  'TECHNOLOGY',
  'VALUABLE',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_STATUSES = ['ACTIVE', 'STORED', 'DAMAGED', 'SEIZED'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * Where an asset is kept, which is a different question from both its
 * condition (`AssetStatus`) and the district it sits in (`Asset.location`).
 *
 * An asset can be in Sentrum, ACTIVE, and carried in the player's inventory all
 * at once - the three describe different things and never substitute for each
 * other. Note that `AssetStatus` also has a `STORED` value; that one means
 * "put away and not in use", this one means "not in the inventory".
 */
export const ASSET_STORAGES = ['INVENTORY', 'STORED'] as const;
export type AssetStorage = (typeof ASSET_STORAGES)[number];

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  VEHICLE: 'Kjøretøy',
  EQUIPMENT: 'Utstyr',
  TECHNOLOGY: 'Teknologi',
  VALUABLE: 'Verdier',
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  ACTIVE: 'Aktiv',
  STORED: 'Lagret',
  DAMAGED: 'Skadet',
  SEIZED: 'Beslaglagt',
};

export const ASSET_STORAGE_LABELS: Record<AssetStorage, string> = {
  INVENTORY: 'I inventar',
  STORED: 'På lager',
};

/** Which statuses allow a sale. Repair and seizure do not exist yet. */
export const SELLABLE_STATUSES: readonly AssetStatus[] = ['ACTIVE', 'STORED'];

export const ASSET_STATUS_BLOCK_REASONS: Record<AssetStatus, string | null> = {
  ACTIVE: null,
  STORED: null,
  DAMAGED: 'Skadde eiendeler kan ikke selges før reparasjon finnes.',
  SEIZED: 'Beslaglagte eiendeler kan ikke selges.',
};

/**
 * Which statuses allow an asset to be carried.
 *
 * Deliberately the same set that allows a sale: a damaged or seized asset is
 * not available to the player, and "available" should mean one thing across the
 * system rather than two subtly different things.
 */
export const CARRYABLE_STATUSES: readonly AssetStatus[] = SELLABLE_STATUSES;

export const ASSET_CARRY_BLOCK_REASONS: Record<AssetStatus, string | null> = {
  ACTIVE: null,
  STORED: null,
  DAMAGED: 'Skadde eiendeler kan ikke bæres.',
  SEIZED: 'Beslaglagte eiendeler kan ikke bæres.',
};

/** How many slots a player's inventory holds. */
export const INVENTORY_CAPACITY = 10;

export const ASSET_TUNING = {
  /** Share of the purchase price a mint-condition asset sells for. */
  saleValueFactor: 0.8,
  minCondition: 0,
  maxCondition: 100,
  /** Condition a freshly bought asset starts at. */
  startCondition: 100,
} as const;

export interface AssetTypeDefinition {
  id: string;
  name: string;
  category: AssetCategory;
  /** Norwegian flavour, one or two sentences. */
  description: string;
  purchasePrice: number;
  /** Kroner per day. Computed but not charged in v1. */
  maintenanceCostPerDay: number;
  /** How much attention owning it draws, 0-100. */
  visibility: number;
  /** How much trouble it can bring, 0-5. */
  risk: number;
  /** Whether the type can be carried at all. Vehicles cannot. */
  inventoryEligible: boolean;
  /**
   * Slots it takes up when carried. Read from the catalogue rather than copied
   * onto the row at purchase: how much room a thing takes is a rule about
   * carrying, not a property of the individual object.
   */
  inventorySlots: number;
}

export const ASSET_TYPES: readonly AssetTypeDefinition[] = [
  /* -------------------------------- Kjøretøy ------------------------------- */
  {
    id: 'gammel-sykkel',
    name: 'Gammel sykkel',
    category: 'VEHICLE',
    description: 'Rusten ramme, sliten kjede. Ingen ser to ganger på den.',
    purchasePrice: 1500,
    maintenanceCostPerDay: 10,
    visibility: 5,
    risk: 1,
    inventoryEligible: false,
    inventorySlots: 0,
  },
  {
    id: 'moped',
    name: 'Moped',
    category: 'VEHICLE',
    description: 'Kommer seg gjennom trafikken og forsvinner i en bakgate.',
    purchasePrice: 8000,
    maintenanceCostPerDay: 50,
    visibility: 15,
    risk: 2,
    inventoryEligible: false,
    inventorySlots: 0,
  },
  {
    id: 'bruktbil',
    name: 'Bruktbil',
    category: 'VEHICLE',
    description: 'Grå, umerkelig og full av andres historie. Akkurat passe kjedelig.',
    purchasePrice: 35000,
    maintenanceCostPerDay: 150,
    visibility: 30,
    risk: 3,
    inventoryEligible: false,
    inventorySlots: 0,
  },
  {
    id: 'sedan',
    name: 'Sedan',
    category: 'VEHICLE',
    description: 'Ser ut som noe en revisor kjører. Det er hele poenget.',
    purchasePrice: 75000,
    maintenanceCostPerDay: 300,
    visibility: 35,
    risk: 3,
    inventoryEligible: false,
    inventorySlots: 0,
  },
  {
    id: 'sportsbil',
    name: 'Sportsbil',
    category: 'VEHICLE',
    description: 'Rask, vakker og fullstendig umulig å skjule. Alle husker den.',
    purchasePrice: 250000,
    maintenanceCostPerDay: 900,
    visibility: 75,
    risk: 5,
    inventoryEligible: false,
    inventorySlots: 0,
  },

  /* --------------------------------- Utstyr -------------------------------- */
  {
    id: 'lommelykt',
    name: 'Lommelykt',
    category: 'EQUIPMENT',
    description: 'Billig, liten og alltid i lomma. Undervurdert.',
    purchasePrice: 500,
    maintenanceCostPerDay: 0,
    visibility: 0,
    risk: 0,
    inventoryEligible: true,
    inventorySlots: 1,
  },
  {
    id: 'laseverktoy',
    name: 'Låseverktøy',
    category: 'EQUIPMENT',
    description: 'Et sett fine pinner i et etui. Vanskelig å forklare bort.',
    purchasePrice: 4000,
    maintenanceCostPerDay: 25,
    visibility: 5,
    risk: 2,
    inventoryEligible: true,
    inventorySlots: 1,
  },
  {
    id: 'verktoykasse',
    name: 'Verktøykasse',
    category: 'EQUIPMENT',
    description: 'Helt lovlig, helt hverdagslig. Åpner det meste med tid.',
    purchasePrice: 7500,
    maintenanceCostPerDay: 40,
    visibility: 5,
    risk: 1,
    inventoryEligible: true,
    inventorySlots: 2,
  },
  {
    id: 'forkledning',
    name: 'Forkledning',
    category: 'EQUIPMENT',
    description: 'Kjeledress, veste og en mappe. Folk ser uniformen, ikke deg.',
    purchasePrice: 3000,
    maintenanceCostPerDay: 10,
    visibility: 10,
    risk: 1,
    inventoryEligible: true,
    inventorySlots: 1,
  },
  {
    id: 'profesjonelt-verktoy',
    name: 'Profesjonelt verktøy',
    category: 'EQUIPMENT',
    description: 'Det ordentlige utstyret. Stille, presist og svært vanskelig å bortforklare.',
    purchasePrice: 25000,
    maintenanceCostPerDay: 100,
    visibility: 10,
    risk: 3,
    inventoryEligible: true,
    inventorySlots: 3,
  },

  /* ------------------------------- Teknologi ------------------------------- */
  {
    id: 'enkel-telefon',
    name: 'Enkel telefon',
    category: 'TECHNOLOGY',
    description: 'Kontantkort, ingen konto, kastes når som helst.',
    purchasePrice: 1000,
    maintenanceCostPerDay: 5,
    visibility: 10,
    risk: 1,
    inventoryEligible: true,
    inventorySlots: 1,
  },
  {
    id: 'smarttelefon',
    name: 'Smarttelefon',
    category: 'TECHNOLOGY',
    description: 'Alt du trenger på ett sted — inkludert alt om deg selv.',
    purchasePrice: 8000,
    maintenanceCostPerDay: 20,
    visibility: 15,
    risk: 1,
    inventoryEligible: true,
    inventorySlots: 1,
  },
  {
    id: 'kryptert-telefon',
    name: 'Kryptert telefon',
    category: 'TECHNOLOGY',
    description: 'Ingen sky, ingen logg. Å eie den er i seg selv en påstand.',
    purchasePrice: 35000,
    maintenanceCostPerDay: 50,
    visibility: 20,
    risk: 3,
    inventoryEligible: true,
    inventorySlots: 1,
  },
  {
    id: 'laptop',
    name: 'Laptop',
    category: 'TECHNOLOGY',
    description: 'Arbeidsverktøy for den som jobber med tall som ikke skal ses.',
    purchasePrice: 20000,
    maintenanceCostPerDay: 50,
    visibility: 15,
    risk: 2,
    inventoryEligible: true,
    inventorySlots: 2,
  },
  {
    id: 'overvakningsutstyr',
    name: 'Overvåkningsutstyr',
    category: 'TECHNOLOGY',
    description: 'Kameraer, mikrofoner og tålmodighet. Ser det andre overser.',
    purchasePrice: 75000,
    maintenanceCostPerDay: 150,
    visibility: 40,
    risk: 4,
    inventoryEligible: true,
    inventorySlots: 3,
  },

  /* --------------------------------- Verdier ------------------------------- */
  {
    id: 'solvklokke',
    name: 'Sølvklokke',
    category: 'VALUABLE',
    description: 'Diskret, tung og lett å gjøre om til kontanter.',
    purchasePrice: 12000,
    maintenanceCostPerDay: 0,
    visibility: 10,
    risk: 1,
    inventoryEligible: true,
    inventorySlots: 1,
  },
  {
    id: 'gullkjede',
    name: 'Gullkjede',
    category: 'VALUABLE',
    description: 'Sier noe om deg før du rekker å si det selv.',
    purchasePrice: 35000,
    maintenanceCostPerDay: 0,
    visibility: 20,
    risk: 2,
    inventoryEligible: true,
    inventorySlots: 1,
  },
  {
    id: 'samleobjekt',
    name: 'Samleobjekt',
    category: 'VALUABLE',
    description: 'Verdt mye til rett kjøper, og ingenting til alle andre.',
    purchasePrice: 100000,
    maintenanceCostPerDay: 0,
    visibility: 15,
    risk: 2,
    inventoryEligible: true,
    inventorySlots: 2,
  },
  {
    id: 'sjeldent-kunstverk',
    name: 'Sjeldent kunstverk',
    category: 'VALUABLE',
    description: 'Henger stille på veggen og er verdt mer enn leiligheten rundt.',
    purchasePrice: 500000,
    maintenanceCostPerDay: 0,
    visibility: 20,
    risk: 3,
    inventoryEligible: true,
    inventorySlots: 3,
  },
  {
    id: 'diamant',
    name: 'Diamant',
    category: 'VALUABLE',
    description: 'Passer i en knyttneve. Ingen spør hvor den kom fra.',
    purchasePrice: 1000000,
    maintenanceCostPerDay: 0,
    visibility: 30,
    risk: 4,
    inventoryEligible: true,
    inventorySlots: 2,
  },
];

const ASSET_BY_ID = new Map<string, AssetTypeDefinition>(
  ASSET_TYPES.map((asset) => [asset.id, asset]),
);

export function findAssetType(id: string): AssetTypeDefinition | undefined {
  return ASSET_BY_ID.get(id);
}

export function isAssetTypeId(id: string): boolean {
  return ASSET_BY_ID.has(id);
}

export const ASSET_TYPE_IDS: readonly string[] = ASSET_TYPES.map((a) => a.id);

export function assetTypesByCategory(category: AssetCategory): AssetTypeDefinition[] {
  return ASSET_TYPES.filter((asset) => asset.category === category);
}

/* ------------------------------------------------------------------ *
 * Value
 * ------------------------------------------------------------------ */

export function clampCondition(condition: number): number {
  return Math.round(
    Math.min(ASSET_TUNING.maxCondition, Math.max(ASSET_TUNING.minCondition, condition)),
  );
}

/**
 * What an asset sells for.
 *
 * Selling always loses money: you get back 80 % of what you paid, scaled by
 * condition. Rounded down, so the house never rounds in the player's favour.
 *
 *   75 000 kr at 87 % -> floor(75000 * 0.80 * 0.87) = 52 200 kr
 */
export function calculateSaleValue(purchasePrice: number, condition: number): number {
  const factor = clampCondition(condition) / 100;
  return Math.max(0, Math.floor(purchasePrice * ASSET_TUNING.saleValueFactor * factor));
}

export interface MaintenanceInput {
  maintenanceCostPerDay: number;
  /** When maintenance was last settled. */
  maintenancePaidAt: Date;
}

/**
 * Maintenance owed since it was last settled.
 *
 * Nothing charges this in v1 — there is no cron job and no automatic wear. It
 * exists so a later upkeep system has one definition to build on rather than
 * inventing its own.
 */
export function calculateMaintenanceDue(
  asset: MaintenanceInput,
  now: Date = new Date(),
): number {
  if (asset.maintenanceCostPerDay <= 0) return 0;

  const elapsedMs = now.getTime() - asset.maintenancePaidAt.getTime();
  if (elapsedMs <= 0) return 0;

  const days = elapsedMs / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.floor(days * asset.maintenanceCostPerDay));
}

export function canSellStatus(status: AssetStatus): boolean {
  return SELLABLE_STATUSES.includes(status);
}

/** Norwegian label for a visibility rating. */
export function visibilityLabel(visibility: number): string {
  if (visibility >= 60) return 'Svært synlig';
  if (visibility >= 35) return 'Synlig';
  if (visibility >= 15) return 'Lite synlig';
  return 'Diskret';
}

/** Norwegian label for a risk rating, 0-5. */
export function assetRiskLabel(risk: number): string {
  if (risk >= 5) return 'Svært høy';
  if (risk >= 4) return 'Høy';
  if (risk >= 3) return 'Moderat';
  if (risk >= 2) return 'Lav';
  if (risk >= 1) return 'Svært lav';
  return 'Ingen';
}

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

/** How many slots one asset takes, from the catalogue. Unknown types take 0. */
export function inventorySlotsFor(assetTypeId: string): number {
  return findAssetType(assetTypeId)?.inventorySlots ?? 0;
}

export function isInventoryEligible(assetTypeId: string): boolean {
  return findAssetType(assetTypeId)?.inventoryEligible ?? false;
}

export function canCarryStatus(status: AssetStatus): boolean {
  return CARRYABLE_STATUSES.includes(status);
}

/** Categories that have at least one carryable type, for the UI filter. */
export const CARRYABLE_CATEGORIES: readonly AssetCategory[] = ASSET_CATEGORIES.filter(
  (category) =>
    ASSET_TYPES.some((type) => type.category === category && type.inventoryEligible),
);
