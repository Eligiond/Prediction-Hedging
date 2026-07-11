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
  assert.equal(ranked.results.length, 1);
});

test("rejects unrelated liquid sports markets for an Indonesia fishing hedge", async () => {
  const ranked = await rankMarkets("fisherman in Indonesia hedge China fishing fleet maritime conflict", [
    { ...market("world-cup", "Will China win the FIFA World Cup?"), volume: 50_000_000, liquidity: 20_000_000 },
    market("clash", "China x Philippines military clash before 2027?", "South China Sea maritime dispute"),
    market("baseball", "Will the baseball team win?"),
  ], 10);
  assert.deepEqual(ranked.results.map((result) => result.id), ["clash"]);
  assert.ok(ranked.results[0]?.matchedTerms.includes("china"));
});

test("returns no result instead of inventing an unrelated hedge", async () => {
  const ranked = await rankMarkets("Indonesia fishing fleet maritime conflict", [
    market("sports", "Will a football team win the championship?"),
    market("music", "Will an album launch this year?"),
  ], 10);
  assert.equal(ranked.results.length, 0);
});

test("maps Chinese wording to the China concept", async () => {
  const ranked = await rankMarkets("Chinese fishing fleets near Indonesia", [
    market("clash", "China x Philippines military clash before 2027?"),
    market("sports", "Will France win the World Cup?"),
  ], 10);
  assert.equal(ranked.results[0]?.id, "clash");
  assert.ok(ranked.results[0]?.matchedConcepts.includes("china"));
});
