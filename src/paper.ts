import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Market, Outcome, PaperLedger, Platform } from "./types.js";

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
const pathFor = (userId: string) => join(dataDir, "users", safe(userId), "paper-ledger.json");

export async function getLedger(userId: string): Promise<PaperLedger> {
  try {
    return JSON.parse(await readFile(pathFor(userId), "utf8")) as PaperLedger;
  } catch {
    const startingCash = Number(process.env.PAPER_STARTING_CASH ?? 10_000);
    return { userId: safe(userId), startingCash, cash: startingCash, positions: [], trades: [] };
  }
}

async function saveLedger(ledger: PaperLedger) {
  const path = pathFor(ledger.userId);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

export async function paperTrade(args: {
  userId: string; market: Market; outcome: Outcome; side: "buy" | "sell"; dollars: number;
}) {
  const { userId, market, outcome, side, dollars } = args;
  const price = outcome === "yes" ? market.yesPrice : market.noPrice;
  if (!market.tradable) throw new Error("Market is not currently tradable");
  if (price === null || price <= 0 || price >= 1) throw new Error("No valid market price is available");
  if (!Number.isFinite(dollars) || dollars <= 0) throw new Error("dollars must be positive");
  const shares = dollars / price;
  return recordPaperFill({ userId, market, outcome, side, dollars, shares, price, notional: dollars, executionMode: "local-simulation" });
}

export async function recordPaperFill(args: {
  userId: string; market: Market; outcome: Outcome; side: "buy" | "sell"; shares: number; price: number;
  notional: number; dollars?: number; executionMode: "local-simulation" | "kalshi-demo"; externalOrderId?: string;
}) {
  const { userId, market, outcome, side, shares, price, notional, executionMode, externalOrderId } = args;
  const dollars = args.dollars ?? notional;
  const ledger = await getLedger(userId);
  const existing = ledger.positions.find((position) =>
    position.marketId === market.id && position.platform === market.platform && position.outcome === outcome
      && (position.executionMode ?? "local-simulation") === executionMode,
  );
  if (side === "buy") {
    if (ledger.cash < dollars) throw new Error(`Insufficient paper cash: $${ledger.cash.toFixed(2)} available`);
    ledger.cash -= dollars;
    if (existing) {
      existing.averagePrice = (existing.cost + dollars) / (existing.shares + shares);
      existing.shares += shares;
      existing.cost += dollars;
      existing.lastPrice = price;
    } else {
      ledger.positions.push({ marketId: market.id, platform: market.platform, title: market.title, outcome, shares, averagePrice: price, cost: dollars, lastPrice: price, executionMode });
    }
  } else {
    if (!existing || existing.shares < shares) throw new Error("Insufficient paper shares to sell");
    existing.shares -= shares;
    existing.cost = existing.averagePrice * existing.shares;
    existing.lastPrice = price;
    ledger.cash += dollars;
    if (existing.shares < 0.000001) ledger.positions = ledger.positions.filter((position) => position !== existing);
  }
  const trade = { id: randomUUID(), timestamp: new Date().toISOString(), marketId: market.id, platform: market.platform as Platform, title: market.title, outcome, side, shares, price, notional, executionMode, externalOrderId };
  ledger.trades.unshift(trade);
  await saveLedger(ledger);
  return { trade, ledger, notice: executionMode === "kalshi-demo" ? "Kalshi Demo exchange order with mock funds." : "Local paper simulation only. No exchange order was sent." };
}
