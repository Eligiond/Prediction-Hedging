import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recall, rememberWithMempalace } from "./memory.js";
import { getLedger, paperTrade } from "./paper.js";
import { fetchMarkets, findMarket } from "./providers.js";
import { rankMarkets } from "./search.js";
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
