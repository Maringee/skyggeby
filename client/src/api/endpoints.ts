import type {
  AssetBuyResponse,
  AssetCatalogResponse,
  AssetListResponse,
  AssetSellResponse,
  AuthResponse,
  BusinessBuyResponse,
  BusinessCatalogResponse,
  BusinessDetailResponse,
  BusinessListResponse,
  BusinessWithdrawResponse,
  ContactDiscoverResponse,
  ContactInteractResponse,
  ContactListResponse,
  InventoryActionResponse,
  MessageDeleteResponse,
  MessageDetailResponse,
  MessageListResponse,
  MessageReadResponse,
  MessageRecipientsResponse,
  MessageSendResponse,
  MissionAbandonResponse,
  MissionAcceptResponse,
  MissionDeliverResponse,
  MissionDetailResponse,
  MissionListResponse,
  PlayerSearchResponse,
  PropertyBuyResponse,
  PropertyCatalogResponse,
  PropertyListResponse,
  PropertySellResponse,
  PublicProfileResponse,
  VehicleActionResponse,
  VehicleBuyResponse,
  VehicleCatalogResponse,
  VehicleListResponse,
  VehicleSellResponse,
  UnreadCountResponse,
  InventoryResponse,
  BankActionResponse,
  CityStateResponse,
  CrimeActionResponse,
  CrimeListResponse,
  ExploreResponse,
  InformationListResponse,
  SkillListResponse,
  SkillUpgradeResponse,
  MoveResponse,
  LoginPayload,
  MeResponse,
  RegisterPayload,
  TransactionListResponse,
} from '@skyggeby/shared';
import { apiRequest } from './client';

export const api = {
  register: (payload: RegisterPayload) =>
    apiRequest<AuthResponse>('/auth/registrer', { method: 'POST', body: payload }),

  login: (payload: LoginPayload) =>
    apiRequest<AuthResponse>('/auth/logg-inn', { method: 'POST', body: payload }),

  logout: () => apiRequest<{ message: string }>('/auth/logg-ut', { method: 'POST' }),

  me: (signal?: AbortSignal) =>
    apiRequest<MeResponse>('/auth/meg', signal ? { signal } : {}),

  profile: () => apiRequest<MeResponse>('/spiller/profil'),

  transactions: (limit = 12) =>
    apiRequest<TransactionListResponse>(`/spiller/transaksjoner?limit=${limit}`),

  deposit: (amount: number) =>
    apiRequest<BankActionResponse>('/spiller/bank/innskudd', {
      method: 'POST',
      body: { amount },
    }),

  city: () => apiRequest<CityStateResponse>('/by'),

  /** The client only names a district; the server decides everything else. */
  move: (districtId: string) =>
    apiRequest<MoveResponse>('/by/flytt', { method: 'POST', body: { districtId } }),

  assets: () => apiRequest<AssetListResponse>('/eiendeler'),

  assetCatalog: () => apiRequest<AssetCatalogResponse>('/eiendeler/katalog'),

  /** The client names a type; the server decides the price and the district. */
  buyAsset: (assetTypeId: string) =>
    apiRequest<AssetBuyResponse>('/eiendeler/kjop', {
      method: 'POST',
      body: { assetTypeId },
    }),

  sellAsset: (assetId: string) =>
    apiRequest<AssetSellResponse>('/eiendeler/selg', {
      method: 'POST',
      body: { assetId },
    }),

  businesses: () => apiRequest<BusinessListResponse>('/virksomheter'),

  businessCatalog: () => apiRequest<BusinessCatalogResponse>('/virksomheter/katalog'),

  business: (businessId: string) =>
    apiRequest<BusinessDetailResponse>(
      `/virksomheter/${encodeURIComponent(businessId)}`,
    ),

  /** The client names a type and a name; every number is the server's. */
  buyBusiness: (businessTypeId: string, name: string) =>
    apiRequest<BusinessBuyResponse>('/virksomheter/kjop', {
      method: 'POST',
      body: { businessTypeId, name },
    }),

  withdrawFromBusiness: (businessId: string) =>
    apiRequest<BusinessWithdrawResponse>('/virksomheter/uttak', {
      method: 'POST',
      body: { businessId },
    }),

  /** Public profile. The URL carries the name, never an internal id. */
  playerProfile: (username: string) =>
    apiRequest<PublicProfileResponse>(`/spillere/${encodeURIComponent(username)}`),

  searchPlayers: (query: string) =>
    apiRequest<PlayerSearchResponse>(`/spillere/sok?sok=${encodeURIComponent(query)}`),

  messages: (box: 'innboks' | 'sendt' = 'innboks', cursor?: string) =>
    apiRequest<MessageListResponse>(
      `/meldinger?boks=${box}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  message: (messageId: string) =>
    apiRequest<MessageDetailResponse>(`/meldinger/${encodeURIComponent(messageId)}`),

  unreadMessages: (signal?: AbortSignal) =>
    apiRequest<UnreadCountResponse>('/meldinger/uleste', signal ? { signal } : {}),

  findRecipients: (query: string) =>
    apiRequest<MessageRecipientsResponse>(
      `/meldinger/mottakere?sok=${encodeURIComponent(query)}`,
    ),

  /** The sender is the session's; the client only names who it goes to. */
  sendMessage: (recipientId: string, subject: string, content: string) =>
    apiRequest<MessageSendResponse>('/meldinger/send', {
      method: 'POST',
      body: { recipientId, subject, content },
    }),

  readMessage: (messageId: string) =>
    apiRequest<MessageReadResponse>(
      `/meldinger/${encodeURIComponent(messageId)}/les`,
      { method: 'POST' },
    ),

  deleteMessage: (messageId: string) =>
    apiRequest<MessageDeleteResponse>(
      `/meldinger/${encodeURIComponent(messageId)}/slett`,
      { method: 'POST' },
    ),

  missions: () => apiRequest<MissionListResponse>('/oppdrag'),

  mission: (missionId: string) =>
    apiRequest<MissionDetailResponse>(`/oppdrag/${encodeURIComponent(missionId)}`),

  /**
   * The client names a mission and nothing else. Requirements, objectives and
   * rewards are all read from the server's own catalogue.
   */
  acceptMission: (missionId: string) =>
    apiRequest<MissionAcceptResponse>(
      `/oppdrag/${encodeURIComponent(missionId)}/godta`,
      { method: 'POST' },
    ),

  deliverMission: (missionId: string) =>
    apiRequest<MissionDeliverResponse>(
      `/oppdrag/${encodeURIComponent(missionId)}/lever`,
      { method: 'POST' },
    ),

  abandonMission: (missionId: string) =>
    apiRequest<MissionAbandonResponse>(
      `/oppdrag/${encodeURIComponent(missionId)}/avbryt`,
      { method: 'POST' },
    ),

  properties: () => apiRequest<PropertyListResponse>('/eiendom'),

  propertyCatalog: () => apiRequest<PropertyCatalogResponse>('/eiendom/katalog'),

  /** The client names a type and a name; every number is the server's. */
  buyProperty: (propertyTypeId: string, name: string) =>
    apiRequest<PropertyBuyResponse>('/eiendom/kjop', {
      method: 'POST',
      body: { propertyTypeId, name },
    }),

  sellProperty: (propertyId: string) =>
    apiRequest<PropertySellResponse>('/eiendom/selg', {
      method: 'POST',
      body: { propertyId },
    }),

  vehicles: () => apiRequest<VehicleListResponse>('/kjoretoy'),

  vehicleCatalog: () => apiRequest<VehicleCatalogResponse>('/kjoretoy/katalog'),

  /** The client names a type and a name; every number is the server's. */
  buyVehicle: (vehicleTypeId: string, name: string) =>
    apiRequest<VehicleBuyResponse>('/kjoretoy/kjop', {
      method: 'POST',
      body: { vehicleTypeId, name },
    }),

  activateVehicle: (vehicleId: string) =>
    apiRequest<VehicleActionResponse>('/kjoretoy/aktiver', {
      method: 'POST',
      body: { vehicleId },
    }),

  parkVehicle: (vehicleId: string) =>
    apiRequest<VehicleActionResponse>('/kjoretoy/park', {
      method: 'POST',
      body: { vehicleId },
    }),

  /** The destination is checked against the district catalogue server-side. */
  moveVehicle: (vehicleId: string, destinationDistrictId: string) =>
    apiRequest<VehicleActionResponse>('/kjoretoy/flytt', {
      method: 'POST',
      body: { vehicleId, destinationDistrictId },
    }),

  sellVehicle: (vehicleId: string) =>
    apiRequest<VehicleSellResponse>('/kjoretoy/selg', {
      method: 'POST',
      body: { vehicleId },
    }),

  contacts: () => apiRequest<ContactListResponse>('/kontakter'),

  /** Sends nothing: who turns up is decided from the player's own state. */
  discoverContact: () =>
    apiRequest<ContactDiscoverResponse>('/kontakter/oppdag', { method: 'POST' }),

  contactPerson: (contactId: string) =>
    apiRequest<ContactInteractResponse>('/kontakter/kontakt', {
      method: 'POST',
      body: { contactId },
    }),

  inventory: () => apiRequest<InventoryResponse>('/inventar'),

  /** The client names an asset; capacity and ownership are the server's call. */
  addToInventory: (assetId: string) =>
    apiRequest<InventoryActionResponse>('/inventar/legg-inn', {
      method: 'POST',
      body: { assetId },
    }),

  removeFromInventory: (assetId: string) =>
    apiRequest<InventoryActionResponse>('/inventar/ta-ut', {
      method: 'POST',
      body: { assetId },
    }),

  skills: () => apiRequest<SkillListResponse>('/ferdigheter'),

  /** The client names a skill and nothing else. */
  upgradeSkill: (skillId: string) =>
    apiRequest<SkillUpgradeResponse>('/ferdigheter/oppgrader', {
      method: 'POST',
      body: { skillId },
    }),

  information: () => apiRequest<InformationListResponse>('/informasjon'),

  /** Explores the district the server says the player is in. Sends nothing. */
  explore: () =>
    apiRequest<ExploreResponse>('/informasjon/utforsk', { method: 'POST' }),

  crimes: () => apiRequest<CrimeListResponse>('/kriminalitet'),

  performCrime: (crimeId: string) =>
    apiRequest<CrimeActionResponse>(`/kriminalitet/${encodeURIComponent(crimeId)}`, {
      method: 'POST',
    }),

  withdraw: (amount: number) =>
    apiRequest<BankActionResponse>('/spiller/bank/uttak', {
      method: 'POST',
      body: { amount },
    }),
};
