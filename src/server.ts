import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadExposure, recall, rememberWithMempalace, saveBasket, saveExposure, saveRiskOffsets } from "./memory.js";
import { getLedger, paperTrade } from "./paper.js";
import { findMarket, searchMarkets } from "./providers.js";
import { rankMarkets } from "./search.js";
import { getDashboard } from "./dashboard.js";
import { scanAndStoreAlerts } from "./intelligence.js";
import { analyzeExposure, buildContingencyBasket, rankRiskOffsets } from "./hedging.js";
import type { Platform } from "./types.js";
import { executeKalshiDemoTrade, fetchKalshiDemoMarkets, getKalshiDemoStatus } from "./kalshiDemo.js";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const platformsSchema = z.array(z.enum(["kalshi", "polymarket"])).default(["kalshi", "polymarket"]);

export function createServer() {
  const server = new McpServer({ name: "riskoff", version: "0.1.0" });

  server.registerTool("search_prediction_markets", {
    title: "Semantic prediction-market search",
    description: "Searches and normalizes active Kalshi and Polymarket markets. Use natural-language exposure, event, or hedge descriptions.",
    inputSchema: {
      query: z.string().min(2), platforms: platformsSchema,
      limit: z.number().int().min(1).max(25).default(10), scan_limit: z.number().int().min(25).max(3000).default(500),
    },
  }, async ({ query, platforms, limit, scan_limit }) => {
    const fetched = await searchMarkets(query, platforms as Platform[], scan_limit);
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
    const perScenario = await Promise.all(stored.profile.lossScenarios.map(async (scenario) => {
      const query = scenario.searchTerms.join(" ");
      const fetched = await searchMarkets(query, platforms as Platform[], scan_limit);
      const ranked = await rankMarkets(query, fetched.markets, 15);
      return { results: ranked.results, errors: fetched.errors };
    }));
    const markets = [...new Map(perScenario.flatMap((item) => item.results).map((market) => [`${market.platform}:${market.id}`, market])).values()];
    const providerErrors = [...new Set(perScenario.flatMap((item) => item.errors))];
    const candidates = rankRiskOffsets(stored.profile, markets, maximum_candidates);
    await saveRiskOffsets(user_id, exposure_id, candidates);
    const accepted = candidates.filter((candidate) => candidate.classification !== "rejected");
    const rejected = candidates.filter((candidate) => candidate.classification === "rejected");
    return text({
      exposureId: exposure_id, searchedMarketCount: markets.length, providerErrors,
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
      recall(user_id, exposure, 8), searchMarkets(exposure, platforms as Platform[], 1000),
    ]);
    const ranked = await rankMarkets(exposure, fetched.markets, limit);
    const candidates = ranked.results.map((market) => {
      const title = market.title.toLowerCase();
      const regionalClashProxy = title.includes("china") && title.includes("philippines") && title.includes("clash");
      return {
        ...market,
        hedgeFraming: regionalClashProxy
          ? "Closest regional proxy: a paper-only YES position pays if the named China–Philippines military clash occurs. It does not pay merely because Chinese fishing pressure or fish-catch losses increase."
          : `This is only an indirect scenario candidate for “${exposure}”. Determine the payoff direction and verify contract resolution terms before considering even a paper trade.`,
        basisRisk: regionalClashProxy ? "high" : "very high",
        suggestedMode: "paper-only",
        maxLossPerShare: "Purchase price (binary contracts can expire worthless)",
      };
    });
    const status = candidates.length ? "candidate_markets_found" : "no_defensible_market_hedge_found";
    return text({
      exposure, status, relevantContext: memory.memories,
      mempalaceAvailable: memory.mempalaceAvailable, rankingMode: ranked.mode,
      providerErrors: fetched.errors, candidates,
      guidance: candidates.length
        ? "Only use a candidate if its resolution outcome has a defensible payoff relationship to the exposure. Indirect geopolitical contracts can have substantial basis risk."
        : "No active Kalshi or Polymarket contract passed the relevance gate. Do not substitute an unrelated liquid market; consider insurance, operational diversification, forward sales, or other instruments outside prediction markets.",
      disclaimer: "Research support only; prediction-market contracts are risky and may not correlate with your exposure.",
    });
  });

  server.registerTool("get_paper_portfolio", {
    title: "Get paper portfolio",
    description: "Returns paper cash, positions, and recent simulated trades. It never accesses a real brokerage or exchange account.",
    inputSchema: { user_id: z.string().min(1) },
  }, async ({ user_id }) => text({ ledger: await getLedger(user_id), kalshiDemo: await getKalshiDemoStatus(), mode: "paper-only" }));

  server.registerTool("get_kalshi_demo_status", {
    title: "Get Kalshi Demo connection status",
    description: "Checks the official Kalshi Demo account that uses mock funds. This never connects to Kalshi production.",
    inputSchema: {},
  }, async () => text(await getKalshiDemoStatus()));

  server.registerTool("search_kalshi_demo_markets", {
    title: "Search official Kalshi Demo markets",
    description: "Searches the markets that can receive mock-funds orders in the official Kalshi Demo environment. Use this before executing a Kalshi paper trade.",
    inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(25).default(10), scan_limit: z.number().int().min(25).max(1000).default(500) },
  }, async ({ query, limit, scan_limit }) => {
    const markets = await fetchKalshiDemoMarkets(scan_limit);
    return text({ query, environment: "kalshi-demo", ...(await rankMarkets(query, markets, limit)) });
  });

  server.registerTool("get_trade_performance", {
    title: "Get marked paper-trade performance",
    description: "Marks open paper positions to current exchange prices and returns equity, profit/loss, position performance, and saved history.",
    inputSchema: { user_id: z.string().min(1) },
  }, async ({ user_id }) => text(await getDashboard(user_id)));

  server.registerTool("scan_political_risk", {
    title: "Scan web news for political risk changes",
    description: "Searches current web news for a user exposure, stores source-linked alerts, and explains why each signal may matter. It never trades automatically.",
    inputSchema: { user_id: z.string().min(1), query: z.string().min(3).max(500) },
  }, async ({ user_id, query }) => text(await scanAndStoreAlerts(user_id, query)));

  server.registerTool("execute_paper_trade", {
    title: "Execute paper trade",
    description: "Submits Kalshi orders to the official Demo exchange when configured, or locally simulates Polymarket using live prices. This tool cannot place real-money orders.",
    inputSchema: {
      user_id: z.string().min(1), platform: z.enum(["kalshi", "polymarket"]), market_id: z.string().min(1),
      outcome: z.enum(["yes", "no"]), side: z.enum(["buy", "sell"]), dollars: z.number().positive().max(100000),
      confirm: z.literal(true).describe("Must be true after the user confirms the exact simulated trade."),
    },
  }, async ({ user_id, platform, market_id, outcome, side, dollars }) => {
    if (platform === "kalshi") {
      return text(await executeKalshiDemoTrade({ userId: user_id, marketId: market_id, outcome, side, dollars }));
    }
    const market = await findMarket(platform as Platform, market_id);
    if (!market) throw new Error("Market not found");
    return text(await paperTrade({ userId: user_id, market, outcome, side, dollars }));
  });

  return server;
}
