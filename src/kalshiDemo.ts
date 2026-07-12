import { constants, createPrivateKey, randomUUID, sign } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { recordPaperFill } from "./paper.js";
import type { Market, Outcome } from "./types.js";

const BASE_URL = "https://external-api.demo.kalshi.co";
const API_ROOT = "/trade-api/v2";
const dataDir = resolve(process.env.DATA_DIR ?? "data");
const credentialsPath = () => join(dataDir, "config", "kalshi-demo.json");

export interface KalshiDemoCredentials {
  apiKeyId: string;
  privateKey: string;
}

interface DemoMarketRecord extends Record<string, unknown> {
  ticker?: string;
  title?: string;
  status?: string;
  yes_ask_dollars?: string;
  yes_bid_dollars?: string;
  no_ask_dollars?: string;
  no_bid_dollars?: string;
  close_time?: string;
}

function normalizeDemoMarket(market: DemoMarketRecord): Market {
  const yesPrice = price(market.yes_ask_dollars) ?? price(market.yes_bid_dollars);
  const noPrice = price(market.no_ask_dollars) ?? price(market.no_bid_dollars) ?? (yesPrice === null ? null : 1 - yesPrice);
  return {
    id: String(market.ticker ?? ""),
    platform: "kalshi",
    title: String(market.title ?? market.ticker ?? "Kalshi Demo market"),
    description: String(market.rules_primary ?? "Kalshi Demo exchange market"),
    yesPrice,
    noPrice,
    volume: Number(market.volume_fp ?? 0),
    liquidity: Number(market.liquidity_dollars ?? 0),
    closesAt: market.close_time ? String(market.close_time) : null,
    url: `https://demo.kalshi.co/markets/${encodeURIComponent(String(market.ticker ?? ""))}`,
    tradable: market.status === "active",
    bestBid: price(market.yes_bid_dollars),
    bestAsk: price(market.yes_ask_dollars),
    settlementRules: String(market.rules_primary ?? ""),
    fetchedAt: new Date().toISOString(),
  };
}

export async function findKalshiDemoMarket(ticker: string): Promise<Market | null> {
  const response = await fetch(`${BASE_URL}${API_ROOT}/markets/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Kalshi Demo market lookup failed (${response.status})`);
  const market = ((await response.json()) as { market?: DemoMarketRecord }).market;
  return market ? normalizeDemoMarket(market) : null;
}

export async function fetchKalshiDemoMarkets(limit = 500): Promise<Market[]> {
  const url = new URL(`${BASE_URL}${API_ROOT}/markets`);
  url.searchParams.set("status", "open");
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 1000)));
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Kalshi Demo market search failed (${response.status})`);
  const payload = await response.json() as { markets?: DemoMarketRecord[] };
  return (payload.markets ?? []).map(normalizeDemoMarket);
}

function price(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : null;
}

export function signKalshiRequest(credentials: KalshiDemoCredentials, timestamp: string, method: string, path: string): string {
  const privateKey = createPrivateKey(credentials.privateKey);
  if (privateKey.asymmetricKeyType !== "rsa" && privateKey.asymmetricKeyType !== "rsa-pss") {
    throw new Error("Kalshi requires an RSA private key");
  }
  const message = Buffer.from(`${timestamp}${method.toUpperCase()}${path.split("?")[0]}`);
  return sign("sha256", message, {
    key: privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

async function loadCredentials(): Promise<KalshiDemoCredentials | null> {
  try {
    const value = JSON.parse(await readFile(credentialsPath(), "utf8")) as KalshiDemoCredentials;
    return value.apiKeyId && value.privateKey ? value : null;
  } catch {
    return null;
  }
}

async function request<T>(endpoint: string, method = "GET", body?: unknown, supplied?: KalshiDemoCredentials): Promise<T> {
  const credentials = supplied ?? await loadCredentials();
  if (!credentials) throw new Error("Connect a Kalshi Demo account in Riskoff Connections first");
  const path = `${API_ROOT}${endpoint}`;
  const timestamp = Date.now().toString();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "KALSHI-ACCESS-KEY": credentials.apiKeyId,
      "KALSHI-ACCESS-TIMESTAMP": timestamp,
      "KALSHI-ACCESS-SIGNATURE": signKalshiRequest(credentials, timestamp, method, path),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const details = payload.error && typeof payload.error === "object" ? JSON.stringify(payload.error) : JSON.stringify(payload);
    throw new Error(`Kalshi Demo rejected the request (${response.status}): ${details.slice(0, 500)}`);
  }
  return payload as T;
}

export async function configureKalshiDemo(credentials: KalshiDemoCredentials) {
  const apiKeyId = credentials.apiKeyId.trim();
  const privateKey = credentials.privateKey.trim();
  if (!apiKeyId || !privateKey.includes("PRIVATE KEY")) throw new Error("Enter the Kalshi Demo API key ID and RSA private key");
  const normalized = { apiKeyId, privateKey: `${privateKey}\n` };
  createPrivateKey(normalized.privateKey);
  const balance = await request<{ balance: number; portfolio_value: number }>("/portfolio/balance", "GET", undefined, normalized);
  await mkdir(join(dataDir, "config"), { recursive: true });
  await writeFile(credentialsPath(), JSON.stringify(normalized), { mode: 0o600 });
  await chmod(credentialsPath(), 0o600);
  return { configured: true, apiKeyHint: `••••${apiKeyId.slice(-4)}`, balance: balance.balance / 100, portfolioValue: balance.portfolio_value / 100, environment: "kalshi-demo" };
}

export async function disconnectKalshiDemo() {
  await rm(credentialsPath(), { force: true });
}

export async function getKalshiDemoStatus() {
  const credentials = await loadCredentials();
  if (!credentials) return { configured: false, environment: "kalshi-demo" as const };
  try {
    const balance = await request<{ balance: number; portfolio_value: number }>("/portfolio/balance", "GET", undefined, credentials);
    return { configured: true, connected: true, apiKeyHint: `••••${credentials.apiKeyId.slice(-4)}`, balance: balance.balance / 100, portfolioValue: balance.portfolio_value / 100, environment: "kalshi-demo" as const };
  } catch (error) {
    return { configured: true, connected: false, apiKeyHint: `••••${credentials.apiKeyId.slice(-4)}`, error: error instanceof Error ? error.message : String(error), environment: "kalshi-demo" as const };
  }
}

export interface DemoOrderPlan {
  side: "bid" | "ask";
  yesPrice: number;
  outcomePrice: number;
  count: number;
}

export function buildKalshiDemoOrderPlan(market: DemoMarketRecord, outcome: Outcome, side: "buy" | "sell", dollars: number): DemoOrderPlan {
  const yesAsk = price(market.yes_ask_dollars);
  const yesBid = price(market.yes_bid_dollars);
  const buysYes = (outcome === "yes" && side === "buy") || (outcome === "no" && side === "sell");
  const yesPrice = buysYes ? yesAsk : yesBid;
  if (yesPrice === null) throw new Error("Kalshi Demo has no executable price for this side");
  const outcomePrice = outcome === "yes" ? yesPrice : 1 - yesPrice;
  if (outcomePrice <= 0 || outcomePrice >= 1) throw new Error("Kalshi Demo returned an invalid outcome price");
  const count = Math.floor((dollars / outcomePrice) * 100) / 100;
  if (count <= 0) throw new Error("Order amount is too small for this market");
  return { side: buysYes ? "bid" : "ask", yesPrice, outcomePrice, count };
}

export async function executeKalshiDemoTrade(args: { userId: string; marketId: string; outcome: Outcome; side: "buy" | "sell"; dollars: number }) {
  const marketPayload = await fetch(`${BASE_URL}${API_ROOT}/markets/${encodeURIComponent(args.marketId)}`, { signal: AbortSignal.timeout(15_000) });
  if (!marketPayload.ok) throw new Error(`Market ${args.marketId} is not available in Kalshi Demo`);
  const marketRecord = ((await marketPayload.json()) as { market?: DemoMarketRecord }).market;
  if (!marketRecord || marketRecord.status !== "active") throw new Error("Kalshi Demo market is not active");
  const plan = buildKalshiDemoOrderPlan(marketRecord, args.outcome, args.side, args.dollars);
  const order = await request<{ order_id: string; fill_count: string; remaining_count: string; average_fill_price?: string; average_fee_paid?: string; ts_ms: number }>(
    "/portfolio/events/orders",
    "POST",
    {
      ticker: args.marketId,
      client_order_id: randomUUID(),
      side: plan.side,
      count: plan.count.toFixed(2),
      price: plan.yesPrice.toFixed(4),
      time_in_force: "fill_or_kill",
      self_trade_prevention_type: "taker_at_cross",
      exchange_index: 0,
    },
  );
  const filled = Number(order.fill_count);
  if (!Number.isFinite(filled) || filled <= 0) return { order, status: "unfilled", environment: "kalshi-demo", notice: "Kalshi Demo accepted the order but it did not fill. No local position was recorded." };
  const averageYesPrice = price(order.average_fill_price) ?? plan.yesPrice;
  const fillPrice = args.outcome === "yes" ? averageYesPrice : 1 - averageYesPrice;
  const market: Market = { ...normalizeDemoMarket(marketRecord), yesPrice: averageYesPrice, noPrice: 1 - averageYesPrice };
  try {
    const recorded = await recordPaperFill({
      userId: args.userId,
      market,
      outcome: args.outcome,
      side: args.side,
      shares: filled,
      price: fillPrice,
      notional: filled * fillPrice,
      executionMode: "kalshi-demo",
      externalOrderId: order.order_id,
    });
    return { order, ...recorded, environment: "kalshi-demo", notice: "Exchange-confirmed Kalshi Demo order using mock funds. No real-money order was sent." };
  } catch (error) {
    return {
      order,
      environment: "kalshi-demo",
      notice: "Kalshi Demo confirmed the mock-funds order, but Riskoff could not mirror it into the local dashboard.",
      localMirrorError: error instanceof Error ? error.message : String(error),
    };
  }
}
