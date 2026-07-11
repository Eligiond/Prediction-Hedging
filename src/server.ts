import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadExposure, recall, rememberWithMempalace, saveBasket, saveExposure, saveRiskOffsets } from "./memory.js";
import { getLedger, paperTrade } from "./paper.js";
import { fetchMarkets, findMarket } from "./providers.js";
import { rankMarkets } from "./search.js";
import { analyzeExposure, buildContingencyBasket, rankRiskOffsets } from "./hedging.js";
import type { Platform } from "./types.js";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const platformsSchema = z.array(z.enum(["kalshi", "polymarket"])).default(["kalshi", "polymarket"]);

export function createServer() {
  const server = new McpServer({ name: "prediction-hedging", version: "0.1.0" });

  server.registerTool("search_prediction_markets", {
    title: "Semantic prediction-market search",
    description: "Searches and normalizes active Kalshi and Polymarket markets. Use natural-language exposure, event, or hedge descriptions.",
    inputSchema: {
      query: z.string().min(2), platforms: platformsSchema,
      limit: z.number().int().min(1).max(25).default(10), scan_limit: z.number().int().min(25).max(500).default(150),
    },
  }, async ({ query, platforms, limit, scan_limit }) => {
    const fetched = await fetchMarkets(platforms as Platform[], scan_limit);
    const ranked = await rankMarkets(query, fetched.markets, limit);
    return text({ query, rankingMode: ranked.mode, providerErrors: fetched.errors, results: ranked.results });
  });

  server.registerTool("analyze_exposure", {
    title: "Analyze financial exposure",
    description: "Converts an explicit business or financial exposure into saved loss scenarios and causal risk channels. This is read-only risk analysis, not trading advice.",
    inputSchema: {
      user_id: z.string().min(1), description: z.string().min(10).max(5000),
      time_horizon: z.string().min(2).max(200).optional(), estimated_loss: z.number().positive().max(1_000_000_000).optional(),
      hedge_budget: z.number().positive().max(1_000_000_000).optional(), target_coverage: z.number().min(0.01).max(1).optional(),
    },
  }, async ({ user_id, description, time_horizon, estimated_loss, hedge_budget, target_coverage }) => {
    const exposure = analyzeExposure({
      userId: user_id, description, timeHorizon: time_horizon, estimatedLoss: estimated_loss,
      hedgeBudget: hedge_budget, targetCoverage: target_coverage,
    });
    await saveExposure(exposure);
    return text({ exposure, disclaimer: "Analytical and read-only. A loss scenario does not establish that a prediction-market contract is a valid hedge." });
  });

  server.registerTool("find_risk_offsets", {
    title: "Find validated event-risk offsets",
    description: "Searches active Kalshi and Polymarket markets for a saved exposure, then rejects markets with wrong payoff direction, incompatible timing, or weak evidence.",
    inputSchema: {
      user_id: z.string().min(1), exposure_id: z.string().min(1), platforms: platformsSchema,
      maximum_candidates: z.number().int().min(1).max(40).default(20), scan_limit: z.number().int().min(25).max(500).default(200),
    },
  }, async ({ user_id, exposure_id, platforms, maximum_candidates, scan_limit }) => {
    const stored = await loadExposure(user_id, exposure_id);
    if (!stored) throw new Error("Exposure not found. Call analyze_exposure first.");
    const fetched = await fetchMarkets(platforms as Platform[], scan_limit);
    const perScenario = await Promise.all(stored.profile.lossScenarios.map(async (scenario) => {
      const ranked = await rankMarkets(scenario.searchTerms.join(" "), fetched.markets, 15);
      return ranked.results;
    }));
    const markets = [...new Map(perScenario.flat().map((market) => [`${market.platform}:${market.id}`, market])).values()];
    const candidates = rankRiskOffsets(stored.profile, markets, maximum_candidates);
    await saveRiskOffsets(user_id, exposure_id, candidates);
    const accepted = candidates.filter((candidate) => candidate.classification !== "rejected");
    const rejected = candidates.filter((candidate) => candidate.classification === "rejected");
    return text({
      exposureId: exposure_id, searchedMarketCount: markets.length, providerErrors: fetched.errors,
      accepted, rejected, disclaimer: "Candidates are partial event-risk offsets only. Verify settlement rules, liquidity, and the relationship to your actual loss before acting.",
    });
  });

  server.registerTool("build_contingency_basket", {
    title: "Build a diversified contingency basket",
    description: "Builds a nonredundant, budget-aware basket from validated saved candidates. It returns fewer candidates when the evidence is weak.",
    inputSchema: {
      user_id: z.string().min(1), exposure_id: z.string().min(1), maximum_budget: z.number().positive().max(1_000_000_000).optional(),
      target_coverage: z.number().min(0.01).max(1).optional(), maximum_contracts: z.number().int().min(1).max(5).default(5),
      maximum_basis_risk: z.enum(["low", "medium", "high"]).default("high"),
    },
  }, async ({ user_id, exposure_id, maximum_budget, target_coverage, maximum_contracts, maximum_basis_risk }) => {
    const stored = await loadExposure(user_id, exposure_id);
    if (!stored) throw new Error("Exposure not found. Call analyze_exposure first.");
    if (!stored.candidates) throw new Error("No saved market search exists. Call find_risk_offsets first.");
    const basket = buildContingencyBasket(stored.profile, stored.candidates, {
      maximumBudget: maximum_budget, targetCoverage: target_coverage, maximumContracts: maximum_contracts, maximumBasisRisk: maximum_basis_risk,
    });
    await saveBasket(user_id, exposure_id, basket);
    return text(basket);
  });

  server.registerTool("explain_residual_risk", {
    title: "Explain residual risk",
    description: "Explains risks that the saved contingency basket does not cover, including basis risk, timing mismatch, liquidity limits, and settlement ambiguity.",
    inputSchema: { user_id: z.string().min(1), exposure_id: z.string().min(1), basket_id: z.string().min(1).optional() },
  }, async ({ user_id, exposure_id, basket_id }) => {
    const stored = await loadExposure(user_id, exposure_id);
    if (!stored) throw new Error("Exposure not found. Call analyze_exposure first.");
    const basket = basket_id ? stored.baskets?.find((item) => item.id === basket_id) : stored.baskets?.at(-1);
    if (!basket) throw new Error("Basket not found. Call build_contingency_basket first.");
    return text({
      exposureId: exposure_id, basketId: basket.id, modeledCoverage: basket.modeledCoverage,
      coveredRiskChannels: [...new Set(basket.recommendations.map((item) => item.riskChannel))],
      uncoveredRisks: basket.uncoveredRisks,
      basisRisk: basket.recommendations.map((item) => ({ title: item.market.title, level: item.basisRisk, explanation: item.basisRiskExplanation })),
      timingAndLiquidityLimits: basket.recommendations.map((item) => ({ title: item.market.title, closesAt: item.market.closesAt, liquidity: item.market.liquidity, dataStatus: item.dataStatus })),
      assumptions: stored.profile.assumptions, warnings: basket.warnings,
    });
  });

  server.registerTool("recall_user_context", {
    title: "Recall relevant user context",
    description: "Retrieves relevant investment preferences, exposures, constraints, and history from MemPalace plus the local profile fallback.",
    inputSchema: { user_id: z.string().min(1), query: z.string().min(2), limit: z.number().int().min(1).max(20).default(8) },
  }, async ({ user_id, query, limit }) => text(await recall(user_id, query, limit)));

  server.registerTool("remember_user_context", {
    title: "Remember user investment context",
    description: "Stores an explicit user-provided preference, exposure, constraint, or correction in the local profile. Never infer or store sensitive facts without user intent.",
    inputSchema: { user_id: z.string().min(1), fact: z.string().min(2).max(2000) },
  }, async ({ user_id, fact }) => text(await rememberWithMempalace(user_id, fact)));

  server.registerTool("recommend_hedges", {
    title: "Personalized hedge candidates",
    description: "Combines user context with live semantic market search to surface possible prediction-market hedges. Candidates are research, not personalized financial advice.",
    inputSchema: {
      user_id: z.string().min(1), exposure: z.string().min(2), platforms: platformsSchema,
      limit: z.number().int().min(1).max(15).default(8),
    },
  }, async ({ user_id, exposure, platforms, limit }) => {
    const [memory, fetched] = await Promise.all([
      recall(user_id, exposure, 8), fetchMarkets(platforms as Platform[], 200),
    ]);
    const context = memory.memories.map((item) => item.text).join("; ");
    const query = `Hedge downside or adverse scenarios for this exposure: ${exposure}. Relevant user context: ${context}`;
    const ranked = await rankMarkets(query, fetched.markets, limit);
    const candidates = ranked.results.map((market) => ({
      ...market,
      hedgeFraming: `Consider the outcome that gains when the adverse scenario for “${exposure}” occurs. Verify contract resolution terms and correlation before trading.`,
      maxLossPerShare: "Purchase price (binary contracts can expire worthless)",
    }));
    return text({ exposure, relevantContext: memory.memories, mempalaceAvailable: memory.mempalaceAvailable, rankingMode: ranked.mode, providerErrors: fetched.errors, candidates, disclaimer: "Research support only; prediction-market contracts are risky and may not correlate with your exposure." });
  });

  server.registerTool("get_paper_portfolio", {
    title: "Get paper portfolio",
    description: "Returns paper cash, positions, and recent simulated trades. It never accesses a real brokerage or exchange account.",
    inputSchema: { user_id: z.string().min(1) },
  }, async ({ user_id }) => text({ ledger: await getLedger(user_id), mode: "paper-only" }));

  server.registerTool("execute_paper_trade", {
    title: "Execute paper trade",
    description: "Simulates a Kalshi or Polymarket trade at the latest displayed price. This tool cannot place real-money orders.",
    inputSchema: {
      user_id: z.string().min(1), platform: z.enum(["kalshi", "polymarket"]), market_id: z.string().min(1),
      outcome: z.enum(["yes", "no"]), side: z.enum(["buy", "sell"]), dollars: z.number().positive().max(100000),
      confirm: z.literal(true).describe("Must be true after the user confirms the exact simulated trade."),
    },
  }, async ({ user_id, platform, market_id, outcome, side, dollars }) => {
    const market = await findMarket(platform as Platform, market_id);
    if (!market) throw new Error("Market not found");
    return text(await paperTrade({ userId: user_id, market, outcome, side, dollars }));
  });

  return server;
}
