import type {
  BasisRisk,
  ContingencyBasket,
  ExposureProfile,
  HedgeClassification,
  LossScenario,
  Market,
  RiskChannel,
  RiskOffsetCandidate,
  ScoreBreakdown,
} from "./types.js";

type ExposureInput = {
  userId: string;
  description: string;
  timeHorizon?: string;
  estimatedLoss?: number;
  hedgeBudget?: number;
  targetCoverage?: number;
};

type ScenarioTemplate = Omit<LossScenario, "id" | "estimatedLoss"> & { keywords: string[] };

const SCENARIOS: ScenarioTemplate[] = [
  {
    description: "Import tariffs or trade restrictions materially increase.",
    relationship: "Higher tariffs reduce gross margin or restrict access to imported goods.",
    importance: 0.9,
    channel: "regulation",
    searchTerms: ["tariffs", "trade policy", "imports", "trade war"],
    keywords: ["tariff", "trade", "import", "customs", "sanction"],
    desiredDirection: "up",
  },
  {
    description: "Fuel, oil, freight, or shipping costs materially increase.",
    relationship: "Higher transport and energy costs reduce operating margin.",
    importance: 0.75,
    channel: "input_costs",
    searchTerms: ["oil prices", "fuel prices", "shipping", "freight", "energy costs"],
    keywords: ["oil", "fuel", "diesel", "shipping", "freight", "energy", "opec"],
    desiredDirection: "up",
  },
  {
    description: "Consumer demand or economic activity materially declines.",
    relationship: "Lower demand reduces revenue and can compress margins.",
    importance: 0.7,
    channel: "demand",
    searchTerms: ["recession", "consumer spending", "unemployment", "economic growth"],
    keywords: ["recession", "unemployment", "consumer", "spending", "gdp", "economy"],
    desiredDirection: "down",
  },
  {
    description: "Adverse weather or climate conditions disrupt operations.",
    relationship: "Extreme weather can reduce output, access, or operating days.",
    importance: 0.7,
    channel: "weather",
    searchTerms: ["hurricane", "storm", "temperature", "weather", "climate"],
    keywords: ["weather", "storm", "hurricane", "temperature", "climate", "rainfall"],
    desiredDirection: "event",
  },
  {
    description: "Operational access is disrupted by a port closure, outage, or supply interruption.",
    relationship: "A disruption prevents normal production, delivery, or service.",
    importance: 0.65,
    channel: "operations",
    searchTerms: ["port closure", "outage", "supply chain", "disruption"],
    keywords: ["port", "outage", "supply", "closure", "disruption", "strike"],
    desiredDirection: "event",
  },
  {
    description: "A geopolitical event materially disrupts supply, access, or demand.",
    relationship: "Conflict, sanctions, or political instability can create financial losses.",
    importance: 0.55,
    channel: "geopolitics",
    searchTerms: ["war", "sanctions", "election", "geopolitics"],
    keywords: ["war", "sanction", "election", "conflict", "geopolitical"],
    desiredDirection: "event",
  },
  {
    description: "A competitor or technology event weakens the business position.",
    relationship: "A competing launch, policy shift, or technical change can reduce revenue.",
    importance: 0.55,
    channel: "technology",
    searchTerms: ["AI launch", "competitor", "semiconductor", "technology regulation"],
    keywords: ["ai", "model", "competitor", "chip", "semiconductor", "technology"],
    desiredDirection: "event",
  },
];

const UP_WORDS = ["rise", "rises", "rising", "increase", "increases", "higher", "above", "more", "surge", "spike"];
const DOWN_WORDS = ["fall", "falls", "falling", "decrease", "decreases", "lower", "below", "less", "decline", "drops"];

const tokenise = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const includesAny = (text: string, values: string[]) => values.some((value) => text.includes(value));

function horizonEnd(value?: string): string | null {
  if (!value) return null;
  const months = value.match(/(\d+)\s*months?/i);
  if (months) {
    const end = new Date();
    end.setMonth(end.getMonth() + Number(months[1]));
    return end.toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function geographyFrom(text: string): string | null {
  const match = text.match(/\b(Argentina|United States|US|Europe|China|Mexico|Canada|Brazil|India|Japan|Australia)\b/i);
  return match?.[1] ?? null;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function analyzeExposure(input: ExposureInput): ExposureProfile {
  const description = input.description.trim();
  const lower = description.toLowerCase();
  const selected = SCENARIOS.filter((scenario) => includesAny(lower, scenario.keywords));
  const templates = selected.length ? selected : [
    {
      description: "Adverse market conditions reduce the value of the described exposure.",
      relationship: "The exact loss trigger needs clarification before a reliable event-risk offset can be selected.",
      importance: 0.4,
      channel: "market_conditions" as RiskChannel,
      searchTerms: tokenise(description).slice(0, 8),
      keywords: [],
      desiredDirection: "event" as const,
    },
  ];
  const totalImportance = templates.reduce((sum, scenario) => sum + scenario.importance, 0);
  const lossScenarios = templates.map((template, index) => ({
    id: `${template.channel}_${index + 1}`,
    description: template.description,
    estimatedLoss: input.estimatedLoss ? Math.round(input.estimatedLoss * (template.importance / totalImportance)) : null,
    relationship: template.relationship,
    importance: template.importance,
    channel: template.channel,
    searchTerms: template.searchTerms,
    desiredDirection: template.desiredDirection,
  }));

  const missingInformation: string[] = [];
  if (!input.estimatedLoss) missingInformation.push("Estimated loss in the damaging scenario.");
  if (!input.timeHorizon) missingInformation.push("Time horizon for the exposure.");
  if (!input.hedgeBudget) missingInformation.push("Maximum protection budget.");
  if (!selected.length) missingInformation.push("Specific drivers that cause the financial loss.");
  return {
    id: makeId("exp"), userId: input.userId, description,
    exposure: description.split(/[.!?]/)[0] || description,
    geography: geographyFrom(description), timeHorizon: input.timeHorizon ?? null,
    horizonEnd: horizonEnd(input.timeHorizon), estimatedDownside: input.estimatedLoss ?? null,
    hedgeBudget: input.hedgeBudget ?? null, targetCoverage: input.targetCoverage ?? null,
    lossScenarios, assumptions: ["This analysis is read-only and assumes binary event contracts pay $1 per winning share."],
    missingInformation, confidence: selected.length >= 2 ? "medium" : "low", createdAt: new Date().toISOString(),
  };
}

function marketDirection(text: string): "up" | "down" | "event" {
  if (includesAny(text, UP_WORDS)) return "up";
  if (includesAny(text, DOWN_WORDS)) return "down";
  return "event";
}

function timeAlignment(market: Market, profile: ExposureProfile): { points: number; reject: boolean } {
  if (!market.closesAt) return { points: 5, reject: false };
  const close = Date.parse(market.closesAt);
  if (Number.isNaN(close) || close < Date.now()) return { points: 0, reject: true };
  if (!profile.horizonEnd) return { points: 10, reject: false };
  const horizon = Date.parse(profile.horizonEnd);
  if (close > horizon + 31 * 24 * 60 * 60 * 1000) return { points: 2, reject: true };
  return { points: 15, reject: false };
}

function liquidityScore(market: Market): number {
  if (!market.tradable || market.yesPrice === null) return 0;
  const value = market.liquidity + market.volume * 0.05;
  if (value >= 100_000) return 10;
  if (value >= 10_000) return 8;
  if (value >= 1_000) return 6;
  if (value > 0) return 3;
  return 1;
}

function basisRisk(classification: HedgeClassification): BasisRisk {
  if (classification === "direct_offset") return "low";
  if (classification === "strong_proxy") return "medium";
  return "high";
}

export function validateCandidate(profile: ExposureProfile, scenario: LossScenario, market: Market): RiskOffsetCandidate {
  const document = `${market.title} ${market.description} ${market.settlementRules ?? ""}`.toLowerCase();
  const keywords = scenario.searchTerms.flatMap(tokenise);
  const matched = keywords.filter((keyword) => document.includes(keyword));
  const timing = timeAlignment(market, profile);
  const isTradable = market.tradable && market.yesPrice !== null;
  const titleDirection = marketDirection(document);
  const oppositeDirection = scenario.desiredDirection !== "event" && titleDirection !== "event" && scenario.desiredDirection !== titleDirection;
  const recommendedSide = oppositeDirection ? "NO" : "YES";
  let classification: HedgeClassification = "weak_proxy";
  let rejectionReason: string | undefined;

  if (!isTradable) rejectionReason = "The market is closed, not tradable, or has no usable price.";
  else if (timing.reject) rejectionReason = "The contract timing is incompatible with the stated exposure period.";
  else if (matched.length === 0) rejectionReason = "The market is topically related but does not identify the loss driver in its terms or rules.";
  else if (scenario.channel === "market_conditions") rejectionReason = "The loss trigger is too vague to validate payoff direction.";
  else if (liquidityScore(market) < 2) rejectionReason = "Available market liquidity is too limited for a defensible recommendation.";
  else if (
    (matched.length >= 2 && (scenario.channel === "regulation" || scenario.channel === "operations"))
    || (scenario.channel === "regulation" && document.includes("tariff"))
  ) classification = "direct_offset";
  else if (matched.length >= 1) classification = "strong_proxy";

  if (rejectionReason) classification = "rejected";
  const risk = basisRisk(classification);
  const components: ScoreBreakdown = {
    payoffAlignment: classification === "rejected" ? 0 : oppositeDirection || titleDirection === scenario.desiredDirection || titleDirection === "event" ? 25 : 8,
    causalStrength: classification === "direct_offset" ? 20 : classification === "strong_proxy" ? 15 : classification === "weak_proxy" ? 7 : 0,
    timeAlignment: timing.points,
    liquidity: liquidityScore(market),
    settlementClarity: market.description || market.settlementRules ? 8 : 3,
    geographicAlignment: profile.geography && document.includes(profile.geography.toLowerCase()) ? 10 : profile.geography ? 4 : 6,
    protectionEfficiency: classification === "direct_offset" ? 10 : classification === "strong_proxy" ? 6 : 3,
  };
  const penalties: Record<string, number> = {};
  if (risk === "medium") penalties.basisRisk = 5;
  if (risk === "high") penalties.basisRisk = 12;
  if (!market.fetchedAt || Date.now() - Date.parse(market.fetchedAt) > 15 * 60 * 1000) penalties.staleData = 3;
  if (market.spread !== undefined && market.spread !== null && market.spread > 0.1) penalties.wideSpread = 4;
  const total = Math.max(0, Math.round(Object.values(components).reduce((sum, value) => sum + value, 0) - Object.values(penalties).reduce((sum, value) => sum + value, 0)));
  const directionValid = classification !== "rejected";
  const sideWords = recommendedSide === "YES" ? "YES" : "NO";
  return {
    id: `${market.platform}:${market.id}:${scenario.id}`, market, scenarioId: scenario.id, riskChannel: scenario.channel,
    recommendedSide: directionValid ? sideWords : null, directionValid, lossScenario: scenario.description,
    marketOutcomeScenario: `The ${sideWords} side pays if the contract's stated event resolves on that side.`,
    alignmentExplanation: directionValid
      ? `${sideWords} is the defensible side because the market references ${matched.join(", ") || "the stated risk"}, which may occur when this loss scenario occurs.`
      : rejectionReason ?? "Payoff direction cannot be defended.",
    relationshipType: classification === "direct_offset" ? "direct" : classification === "strong_proxy" ? "causal_proxy" : classification === "weak_proxy" ? "correlated_proxy" : "ambiguous",
    classification, basisRisk: risk,
    basisRiskExplanation: risk === "low" ? "The market closely matches the stated loss trigger." : risk === "medium" ? "The market is causally related but does not settle on the user's exact financial loss." : "The contract may not pay even when the user loses money.",
    whatItDoesNotProtectAgainst: `It does not protect against other ${scenario.channel.replace(/_/g, " ")} drivers or business-specific losses.`,
    score: { total, components, penalties }, rejectionReason,
    dataStatus: market.fetchedAt && Date.now() - Date.parse(market.fetchedAt) > 15 * 60 * 1000 ? "stale" : "live",
  };
}

export function rankRiskOffsets(profile: ExposureProfile, markets: Market[], maximumCandidates = 20): RiskOffsetCandidate[] {
  const byId = new Map<string, RiskOffsetCandidate>();
  for (const scenario of profile.lossScenarios) {
    for (const market of markets) {
      const candidate = validateCandidate(profile, scenario, market);
      const current = byId.get(candidate.id);
      if (!current || candidate.score.total > current.score.total) byId.set(candidate.id, candidate);
    }
  }
  const ranked = [...byId.values()].sort((a, b) => b.score.total - a.score.total);
  const accepted = ranked.filter((candidate) => candidate.classification !== "rejected");
  const rejected = ranked.filter((candidate) => candidate.classification === "rejected");
  // Keep one rejected example when possible so clients can show the validation layer at work.
  const acceptedLimit = rejected.length ? Math.max(0, maximumCandidates - 1) : maximumCandidates;
  return [...accepted.slice(0, acceptedLimit), ...rejected.slice(0, maximumCandidates - acceptedLimit)];
}

function effectivePrice(candidate: RiskOffsetCandidate): number | null {
  return candidate.recommendedSide === "YES" ? candidate.market.yesPrice : candidate.market.noPrice;
}

export function buildContingencyBasket(
  profile: ExposureProfile,
  candidates: RiskOffsetCandidate[],
  options: { maximumBudget?: number; targetCoverage?: number; maximumContracts?: number; maximumBasisRisk?: BasisRisk },
): ContingencyBasket {
  const allowedRisk: BasisRisk[] = options.maximumBasisRisk === "low" ? ["low"] : options.maximumBasisRisk === "medium" ? ["low", "medium"] : ["low", "medium", "high"];
  const limit = options.maximumContracts ?? 5;
  const budget = options.maximumBudget ?? profile.hedgeBudget ?? null;
  const channels = new Set<RiskChannel>();
  let remaining = budget ?? Number.POSITIVE_INFINITY;
  const recommendations: ContingencyBasket["recommendations"] = [];
  for (const candidate of candidates) {
    if (recommendations.length >= limit || candidate.classification === "rejected" || !allowedRisk.includes(candidate.basisRisk) || channels.has(candidate.riskChannel)) continue;
    const price = effectivePrice(candidate);
    if (price === null || price <= 0 || price >= 1) continue;
    const slotsLeft = limit - recommendations.length;
    let cost = Number.isFinite(remaining) ? remaining / slotsLeft : 0;
    let shares: number | undefined;
    let payout: number | undefined;
    if (candidate.classification === "direct_offset" && profile.estimatedDownside && (options.targetCoverage ?? profile.targetCoverage)) {
      const desiredPayout = profile.estimatedDownside * (options.targetCoverage ?? profile.targetCoverage ?? 0);
      shares = Math.floor(desiredPayout / (1 - price));
      cost = Math.min(shares * price, remaining);
      shares = Math.floor(cost / price);
      payout = shares * (1 - price);
    }
    if (cost <= 0 || (Number.isFinite(remaining) && cost > remaining)) continue;
    recommendations.push({ ...candidate, illustrativeShares: shares, estimatedProtectionCost: Number(cost.toFixed(2)), estimatedBadStatePayout: payout });
    channels.add(candidate.riskChannel);
    remaining -= cost;
  }
  const covered = new Set(recommendations.map((candidate) => candidate.scenarioId));
  const uncoveredRisks = profile.lossScenarios.filter((scenario) => !covered.has(scenario.id)).map((scenario) => scenario.description);
  const estimatedCost = recommendations.reduce((sum, candidate) => sum + (candidate.estimatedProtectionCost ?? 0), 0);
  const proxyCount = recommendations.filter((candidate) => candidate.classification !== "direct_offset").length;
  return {
    id: makeId("basket"), exposureId: profile.id, createdAt: new Date().toISOString(),
    estimatedDownside: profile.estimatedDownside, maximumBudget: budget, estimatedCost: Number(estimatedCost.toFixed(2)),
    targetCoverage: options.targetCoverage ?? profile.targetCoverage ?? null,
    modeledCoverage: recommendations.length ? {
      minimum: Number((recommendations.length * 0.05).toFixed(2)),
      maximum: Number((recommendations.reduce((sum, item) => sum + (item.classification === "direct_offset" ? 0.3 : 0.14), 0)).toFixed(2)),
    } : null,
    recommendations, uncoveredRisks,
    warnings: [
      "Prediction-market positions can lose their full purchase cost.",
      "This is a read-only, analytical contingency basket, not guaranteed insurance or financial advice.",
      ...(proxyCount ? ["Proxy relationships can break: contract settlement may not match the user's real loss."] : []),
      ...(recommendations.length < 3 ? ["Fewer than three candidates met the current direction, timing, liquidity, and basis-risk checks."] : []),
    ],
  };
}
