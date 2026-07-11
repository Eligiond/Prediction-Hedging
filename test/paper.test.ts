import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("paper trades never require exchange credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prediction-hedging-"));
  process.env.DATA_DIR = directory;
  const { paperTrade } = await import(`../src/paper.js?test=${Date.now()}`);
  const result = await paperTrade({
    userId: "test-user",
    market: { id: "m1", platform: "polymarket", title: "Test", description: "", yesPrice: 0.4, noPrice: 0.6, volume: 1, liquidity: 1, closesAt: null, url: "https://example.com", tradable: true },
    outcome: "yes", side: "buy", dollars: 40,
  });
  assert.equal(result.ledger.cash, 9960);
  assert.equal(result.ledger.positions[0]?.shares, 100);
  assert.match(result.notice, /Paper trade only/);
  await rm(directory, { recursive: true, force: true });
});
