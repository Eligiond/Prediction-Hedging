import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recall, rememberWithMempalace } from "./memory.js";
import { getLedger, paperTrade } from "./paper.js";
import { findMarket, searchMarkets } from "./providers.js";
import { rankMarkets } from "./search.js";
import { getDashboard } from "./dashboard.js";
import { scanAndStoreAlerts } from "./intelligence.js";
import type { Platform } from "./types.js";

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
  }, async ({ user_id }) => text({ ledger: await getLedger(user_id), mode: "paper-only" }));

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
