import type { Information } from '@prisma/client';
import type { InformationRelevance, InformationType } from '@skyggeby/shared';

/** A generated discovery, before it is written to the database. */
export interface InformationDraft {
  type: InformationType;
  source: string;
  relevance: InformationRelevance;
  title: string;
  content: string;
  districtId: string | null;
  reliability: number;
  /** Internal truth. Never leaves the server. */
  isTrue: boolean;
  baseValue: number;
  expiresAt: Date | null;
}

export interface ExploreResult {
  /** Null when the search turned up nothing. */
  found: Information | null;
  message: string;
  energySpent: number;
  cooldownUntil: Date;
}

/** The information a crime consumed, and what it actually contributed. */
export interface AppliedInformation {
  information: Information;
  /** Percentage points added to the success chance. */
  bonusPoints: number;
}
