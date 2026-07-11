export type Platform = "kalshi" | "polymarket";
export type Outcome = "yes" | "no";

export interface Market {
  id: string;
  platform: Platform;
  title: string;
  description: string;
  yesPrice: number | null;
  noPrice: number | null;
  volume: number;
  liquidity: number;
  closesAt: string | null;
  url: string;
  tradable: boolean;
  tokenIds?: string[];
  bestBid?: number | null;
  bestAsk?: number | null;
  spread?: number | null;
  settlementRules?: string;
  resolutionSource?: string;
  fetchedAt?: string;
}

export interface RankedMarket extends Market {
  relevance: number;
  matchedConcepts: string[];
}

export interface PaperPosition {
  marketId: string;
  platform: Platform;
  title: string;
  outcome: Outcome;
  shares: number;
  averagePrice: number;
  cost: number;
  lastPrice: number;
}

export interface PaperLedger {
  userId: string;
  startingCash: number;
  cash: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
}

export interface PaperTrade {
  id: string;
  timestamp: string;
  marketId: string;
  platform: Platform;
  title: string;
  outcome: Outcome;
  side: "buy" | "sell";
  shares: number;
  price: number;
  notional: number;
}

export interface UserProfile {
  userId: string;
  facts: Array<{ text: string; createdAt: string }>;
  exposures?: StoredExposure[];
}

export type RiskChannel =
  | "regulation"
  | "input_costs"
  | "demand"
  | "weather"
  | "operations"
  | "geopolitics"
  | "technology"
  | "market_conditions";

export type HedgeClassification = "direct_offset" | "strong_proxy" | "weak_proxy" | "rejected";
export type BasisRisk = "low" | "medium" | "high";

export interface LossScenario {
  id: string;
  description: string;
  estimatedLoss: number | null;
  relationship: string;
  importance: number;
  channel: RiskChannel;
  searchTerms: string[];
  desiredDirection: "up" | "down" | "event";
}

export interface ExposureProfile {
  id: string;
  userId: string;
  description: string;
  exposure: string;
  geography: string | null;
  timeHorizon: string | null;
  horizonEnd: string | null;
  estimatedDownside: number | null;
  hedgeBudget: number | null;
  targetCoverage: number | null;
  lossScenarios: LossScenario[];
  assumptions: string[];
  missingInformation: string[];
  confidence: "low" | "medium" | "high";
  createdAt: string;
}

export interface ScoreBreakdown {
  payoffAlignment: number;
  causalStrength: number;
  timeAlignment: number;
  liquidity: number;
  settlementClarity: number;
  geographicAlignment: number;
  protectionEfficiency: number;
}

export interface RiskOffsetCandidate {
  id: string;
  market: Market;
  scenarioId: string;
  riskChannel: RiskChannel;
  recommendedSide: "YES" | "NO" | null;
  directionValid: boolean;
  lossScenario: string;
  marketOutcomeScenario: string;
  alignmentExplanation: string;
  relationshipType: "direct" | "causal_proxy" | "correlated_proxy" | "ambiguous";
  classification: HedgeClassification;
  basisRisk: BasisRisk;
  basisRiskExplanation: string;
  whatItDoesNotProtectAgainst: string;
  score: { total: number; components: ScoreBreakdown; penalties: Record<string, number> };
  rejectionReason?: string;
  dataStatus: "live" | "stale";
}

export interface ContingencyBasket {
  id: string;
  exposureId: string;
  createdAt: string;
  estimatedDownside: number | null;
  maximumBudget: number | null;
  estimatedCost: number;
  targetCoverage: number | null;
  modeledCoverage: { minimum: number; maximum: number } | null;
  recommendations: Array<RiskOffsetCandidate & {
    illustrativeShares?: number;
    estimatedProtectionCost?: number;
    estimatedBadStatePayout?: number;
  }>;
  uncoveredRisks: string[];
  warnings: string[];
}

export interface StoredExposure {
  profile: ExposureProfile;
  candidates?: RiskOffsetCandidate[];
  baskets?: ContingencyBasket[];
  searchedAt?: string;
}
