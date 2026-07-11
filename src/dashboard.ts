import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getLedger } from "./paper.js";
import { findMarket } from "./providers.js";

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);

export async function getDashboard(userId: string) {
  const ledger = await getLedger(userId);
  const positions = await Promise.all(ledger.positions.map(async (position) => {
    const market = await findMarket(position.platform, position.marketId).catch(() => null);
    const lastPrice = position.outcome === "yes" ? market?.yesPrice : market?.noPrice;
    const markedPrice = lastPrice ?? position.lastPrice;
    const currentValue = position.shares * markedPrice;
    return {
      ...position,
      lastPrice: markedPrice,
      currentValue,
      unrealizedPnl: currentValue - position.cost,
      returnPct: position.cost ? ((currentValue - position.cost) / position.cost) * 100 : 0,
      marketUrl: market?.url ?? null,
      closesAt: market?.closesAt ?? null,
    };
  }));
  const positionsValue = positions.reduce((sum, position) => sum + position.currentValue, 0);
  const equity = ledger.cash + positionsValue;
  const snapshot = { timestamp: new Date().toISOString(), equity, cash: ledger.cash, positionsValue };
  const historyPath = join(dataDir, "users", safe(userId), "performance.json");
  let history: typeof snapshot[] = [];
  try { history = JSON.parse(await readFile(historyPath, "utf8")) as typeof snapshot[]; } catch { /* first snapshot */ }
  const last = history.at(-1);
  if (!last || Date.now() - new Date(last.timestamp).getTime() > 60_000) {
    history.push(snapshot);
    history = history.slice(-1000);
    await mkdir(join(historyPath, ".."), { recursive: true });
    await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  }
  if (history.length === 0) history = [snapshot];
  return {
    mode: "paper-only",
    summary: {
      startingCash: ledger.startingCash, cash: ledger.cash, positionsValue, equity,
      totalPnl: equity - ledger.startingCash,
      returnPct: ledger.startingCash ? ((equity - ledger.startingCash) / ledger.startingCash) * 100 : 0,
      openPositions: positions.length, trades: ledger.trades.length,
    },
    positions,
    trades: ledger.trades,
    history,
  };
}
