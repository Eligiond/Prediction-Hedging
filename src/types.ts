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
}

export interface RankedMarket extends Market {
  relevance: number;
  matchedConcepts: string[];
  matchedTerms: string[];
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
}
