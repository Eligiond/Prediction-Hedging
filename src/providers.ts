import type { Market, Platform } from "./types.js";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const POLYMARKET_BASE = "https://gamma-api.polymarket.com";

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullablePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function getJson(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "riskoff-mcp/0.1" },
    });
    if (!response.ok) throw new Error(`${url.host} returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchKalshiMarkets(limit = 100): Promise<Market[]> {
  const records: Record<string, unknown>[] = [];
  let cursor = "";
  do {
    const url = new URL(`${KALSHI_BASE}/markets`);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", String(Math.min(limit - records.length, 1000)));
    if (cursor) url.searchParams.set("cursor", cursor);
    const payload = (await getJson(url)) as { markets?: Record<string, unknown>[]; cursor?: string };
    records.push(...(payload.markets ?? []));
    cursor = payload.cursor ?? "";
  } while (cursor && records.length < limit);

  return records.slice(0, limit).map((market) => {
    const ticker = String(market.ticker ?? "");
    const yesPrice = nullablePrice(
      market.yes_ask_dollars ?? market.last_price_dollars ?? market.yes_bid_dollars,
    );
    return {
      id: ticker,
      platform: "kalshi",
      title: String(market.title ?? ticker),
      description: [market.yes_sub_title, market.rules_primary, market.rules_secondary]
        .filter(Boolean)
        .join(" "),
      yesPrice,
      noPrice: yesPrice === null ? null : 1 - yesPrice,
      volume: number(market.volume_fp),
      liquidity: number(market.liquidity_dollars),
      closesAt: market.close_time ? String(market.close_time) : null,
      url: `https://kalshi.com/markets/${encodeURIComponent(ticker)}`,
      tradable: market.status === "active",
      bestBid: nullablePrice(market.yes_bid_dollars),
      bestAsk: nullablePrice(market.yes_ask_dollars),
      spread: (() => {
        const bid = nullablePrice(market.yes_bid_dollars);
        const ask = nullablePrice(market.yes_ask_dollars);
        return bid === null || ask === null ? null : ask - bid;
      })(),
      settlementRules: [market.rules_primary, market.rules_secondary].filter(Boolean).join(" "),
      fetchedAt: new Date().toISOString(),
    };
  });
}

export async function fetchPolymarketMarkets(limit = 100): Promise<Market[]> {
  const url = new URL(`${POLYMARKET_BASE}/markets`);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", String(Math.min(limit, 500)));
  url.searchParams.set("order", "volume24hr");
  url.searchParams.set("ascending", "false");
  const payload = (await getJson(url)) as Record<string, unknown>[];
  return payload.map((market) => normalizePolymarket(market));
}

async function searchPolymarketMarkets(query: string, limit: number): Promise<Market[]> {
  const found: Market[] = [];
  const lower = query.toLowerCase();
  const anchors = ["china", "indonesia", "fishing", "fisherman", "maritime", "conflict", "nuclear", "uranium", "oil", "crypto", "bitcoin", "rates", "inflation", "climate"]
    .filter((term) => lower.includes(term) || (term === "china" && lower.includes("chinese")));
  const focused = [...new Set(anchors.map((term) => term === "fisherman" ? "fishing" : term))].join(" ");
  const variants = [...new Set([focused, query.slice(0, 500)].filter((value) => value.length >= 2))].slice(0, 2);

  for (const variant of variants) {
    const url = new URL(`${POLYMARKET_BASE}/public-search`);
    url.searchParams.set("q", variant);
    url.searchParams.set("limit_per_type", String(Math.min(limit, 50)));
    url.searchParams.set("keep_closed_markets", "0");
    url.searchParams.set("events_status", "active");
    const payload = (await getJson(url)) as { events?: Record<string, unknown>[] };
    for (const event of payload.events ?? []) {
      const eventTitle = String(event.title ?? "");
      const eventDescription = String(event.description ?? "");
      const eventSlug = String(event.slug ?? "");
      const markets = Array.isArray(event.markets) ? event.markets as Record<string, unknown>[] : [];
      for (const market of markets) {
        if (market.closed === true || market.active === false) continue;
        found.push(normalizePolymarket(market, { eventTitle, eventDescription, eventSlug }));
      }
    }
  }
  return [...new Map(found.map((market) => [market.id, market])).values()].slice(0, limit);
}

export async function searchMarkets(query: string, platforms: Platform[], limitPerPlatform = 500) {
  const jobs = platforms.map(async (platform) => {
    try {
      const markets = platform === "kalshi"
        ? await fetchKalshiMarkets(limitPerPlatform)
        : await searchPolymarketMarkets(query, limitPerPlatform);
      return { platform, markets };
    } catch (error) {
      return { platform, markets: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  const results = await Promise.all(jobs);
  const errors = results.flatMap((result) => result.error ? [`${result.platform}: ${result.error}`] : []);
  return { markets: results.flatMap((result) => result.markets), errors };
}

export async function fetchMarkets(platforms: Platform[], limitPerPlatform = 100) {
  const jobs = platforms.map(async (platform) => {
    try {
      return {
        platform,
        markets:
          platform === "kalshi"
            ? await fetchKalshiMarkets(limitPerPlatform)
            : await fetchPolymarketMarkets(limitPerPlatform),
      };
    } catch (error) {
      return { platform, markets: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  const results = await Promise.all(jobs);
  const errors = results.flatMap((result) => (result.error ? [`${result.platform}: ${result.error}`] : []));
  return { markets: results.flatMap((result) => result.markets), errors };
}

export async function findMarket(platform: Platform, marketId: string): Promise<Market | null> {
  if (platform === "kalshi") {
    const payload = (await getJson(new URL(`${KALSHI_BASE}/markets/${encodeURIComponent(marketId)}`))) as {
      market?: Record<string, unknown>;
    };
    const market = payload.market;
    if (!market) return null;
    const yesPrice = nullablePrice(
      market.yes_ask_dollars ?? market.last_price_dollars ?? market.yes_bid_dollars,
    );
    return {
      id: String(market.ticker), platform, title: String(market.title),
      description: String(market.rules_primary ?? ""), yesPrice,
      noPrice: yesPrice === null ? null : 1 - yesPrice,
      volume: number(market.volume_fp), liquidity: number(market.liquidity_dollars),
      closesAt: market.close_time ? String(market.close_time) : null,
      url: `https://kalshi.com/markets/${encodeURIComponent(marketId)}`,
      tradable: market.status === "active",
      bestBid: nullablePrice(market.yes_bid_dollars), bestAsk: nullablePrice(market.yes_ask_dollars),
      settlementRules: String(market.rules_primary ?? ""), fetchedAt: new Date().toISOString(),
    };
  }
  const url = new URL(`${POLYMARKET_BASE}/markets`);
  url.searchParams.set("id", marketId);
  const payload = (await getJson(url)) as Record<string, unknown>[];
  return payload.length ? (await fetchPolymarketByRecord(payload[0]!)) : null;
}

async function fetchPolymarketByRecord(market: Record<string, unknown>): Promise<Market> {
  return normalizePolymarket(market);
}

function normalizePolymarket(
  market: Record<string, unknown>,
  event: { eventTitle?: string; eventDescription?: string; eventSlug?: string } = {},
): Market {
  const prices = parseJsonArray(market.outcomePrices).map(Number);
  const id = String(market.id ?? market.conditionId ?? "");
  const slug = event.eventSlug || String(market.slug ?? id);
  return {
    id, platform: "polymarket", title: String(market.question ?? slug),
    description: [event.eventTitle, event.eventDescription, market.description].filter(Boolean).join(" "),
    yesPrice: nullablePrice(prices[0] ?? market.bestAsk ?? market.lastTradePrice),
    noPrice: nullablePrice(prices[1]), volume: number(market.volumeNum ?? market.volume),
    liquidity: number(market.liquidityNum ?? market.liquidity),
    closesAt: market.endDate ? String(market.endDate) : null,
    url: `https://polymarket.com/event/${encodeURIComponent(slug)}`,
    tradable: market.active === true && market.closed !== true && market.acceptingOrders !== false,
    tokenIds: parseJsonArray(market.clobTokenIds),
    bestAsk: nullablePrice(market.bestAsk), settlementRules: String(market.description ?? ""),
    fetchedAt: new Date().toISOString(),
  };
}
