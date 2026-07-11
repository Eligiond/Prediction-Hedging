import assert from "node:assert/strict";
import test from "node:test";
import { rankMarkets } from "../src/search.js";
import type { Market } from "../src/types.js";

const market = (id: string, title: string, description = ""): Market => ({
  id, platform: "kalshi", title, description, yesPrice: 0.5, noPrice: 0.5,
  volume: 100, liquidity: 100, closesAt: null, url: "https://example.com", tradable: true,
});

test("local semantic fallback expands nuclear exposure concepts", async () => {
  const ranked = await rankMarkets("I invest in nuclear; how can I hedge?", [
    market("sports", "Will the baseball team win?"),
    market("energy", "Will uranium prices fall after a reactor shutdown?"),
    market("music", "Will an album launch this year?"),
  ], 3);
  assert.equal(ranked.mode, "local-concept-bm25");
  assert.equal(ranked.results[0]?.id, "energy");
  assert.ok(ranked.results[0]?.matchedConcepts.includes("nuclear"));
});
