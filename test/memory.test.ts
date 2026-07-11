import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeExposure } from "../src/hedging.js";

test("stores and retrieves a structured exposure through the existing local memory fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prediction-hedging-memory-"));
  process.env.DATA_DIR = directory;
  const memory = await import(`../src/memory.js?test=${Date.now()}`);
  const exposure = analyzeExposure({
    userId: "memory-user", description: "I lose margin if fuel prices rise.", timeHorizon: "next 3 months", estimatedLoss: 20_000,
  });
  await memory.saveExposure(exposure);
  const loaded = await memory.loadExposure("memory-user", exposure.id);
  assert.equal(loaded?.profile.description, exposure.description);
  await rm(directory, { recursive: true, force: true });
});
