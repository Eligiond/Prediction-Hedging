import assert from "node:assert/strict";
import test from "node:test";
import { analyzeExposure, buildContingencyBasket, validateCandidate } from "../src/hedging.js";
import type { Market } from "../src/types.js";

const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

function market(id: string, title: string, description = "Clear published resolution rules."): Market {
  return {
    id, platform: "kalshi", title, description, yesPrice: 0.4, noPrice: 0.6,
    volume: 20_000, liquidity: 20_000, closesAt: future, url: "https://example.com", tradable: true,
    fetchedAt: new Date().toISOString(), settlementRules: description,
  };
}

function importerExposure() {
  return analyzeExposure({
    userId: "importer", description: "I import electronics and lose money if tariffs rise, shipping costs spike, or consumer demand falls.",
    timeHorizon: "next 6 months", estimatedLoss: 100_000, hedgeBudget: 10_000, targetCoverage: 0.5,
  });
}

test("validates YES when a tariff increase creates the stated loss", () => {
  const exposure = importerExposure();
  const tariff = exposure.lossScenarios.find((scenario) => scenario.channel === "regulation")!;
  const candidate = validateCandidate(exposure, tariff, market("tariff-up", "Will US tariffs increase this year?"));
  assert.equal(candidate.recommendedSide, "YES");
  assert.equal(candidate.directionValid, true);
  assert.equal(candidate.classification, "direct_offset");
});

test("labels a less exact fuel contract as a proxy rather than a direct offset", () => {
  const exposure = importerExposure();
  const fuel = exposure.lossScenarios.find((scenario) => scenario.channel === "input_costs")!;
  const candidate = validateCandidate(exposure, fuel, market("oil", "Will oil prices rise this year?"));
  assert.equal(candidate.classification, "strong_proxy");
  assert.equal(candidate.basisRisk, "medium");
});

test("validates NO when a market resolves YES on the inverse tariff outcome", () => {
  const exposure = importerExposure();
  const tariff = exposure.lossScenarios.find((scenario) => scenario.channel === "regulation")!;
  const candidate = validateCandidate(exposure, tariff, market("tariff-down", "Will US tariffs fall this year?"));
  assert.equal(candidate.recommendedSide, "NO");
  assert.equal(candidate.directionValid, true);
});

test("rejects a topically unrelated market rather than treating it as a hedge", () => {
  const exposure = importerExposure();
  const tariff = exposure.lossScenarios.find((scenario) => scenario.channel === "regulation")!;
  const candidate = validateCandidate(exposure, tariff, market("music", "Will an album win a Grammy?"));
  assert.equal(candidate.classification, "rejected");
  assert.match(candidate.rejectionReason ?? "", /topically related/);
});

test("rejects markets that settle after the exposure horizon", () => {
  const exposure = importerExposure();
  exposure.horizonEnd = "2026-12-31T00:00:00.000Z";
  const tariff = exposure.lossScenarios.find((scenario) => scenario.channel === "regulation")!;
  const candidate = validateCandidate(exposure, tariff, { ...market("late", "Will tariffs increase?"), closesAt: "2099-12-31T00:00:00.000Z" });
  assert.equal(candidate.classification, "rejected");
  assert.match(candidate.rejectionReason ?? "", /timing/);
});

test("builds a nonredundant basket within the protection budget", () => {
  const exposure = importerExposure();
  const candidates = exposure.lossScenarios.map((scenario, index) => validateCandidate(exposure, scenario, market(
    `m${index}`, `${scenario.searchTerms[0]} will increase or occur?`,
  )));
  const basket = buildContingencyBasket(exposure, candidates, {
    maximumBudget: 10_000, targetCoverage: 0.5, maximumContracts: 5, maximumBasisRisk: "high",
  });
  assert.ok(basket.estimatedCost <= 10_000);
  assert.equal(new Set(basket.recommendations.map((item) => item.riskChannel)).size, basket.recommendations.length);
});
