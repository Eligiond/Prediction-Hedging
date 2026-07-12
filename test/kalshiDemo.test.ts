import assert from "node:assert/strict";
import { constants, generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { buildKalshiDemoOrderPlan, signKalshiRequest } from "../src/kalshiDemo.js";

test("signs Kalshi Demo requests with RSA-PSS SHA-256", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credentials = {
    apiKeyId: "demo-key",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  const timestamp = "1703123456789";
  const path = "/trade-api/v2/portfolio/balance";
  const signature = Buffer.from(signKalshiRequest(credentials, timestamp, "GET", path), "base64");
  assert.equal(verify("sha256", Buffer.from(`${timestamp}GET${path}`), {
    key: publicKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }, signature), true);
});

test("maps YES and NO buys to the Kalshi single-book order side", () => {
  const market = { yes_ask_dollars: "0.4200", yes_bid_dollars: "0.4000" };
  assert.deepEqual(buildKalshiDemoOrderPlan(market, "yes", "buy", 42), {
    side: "bid", yesPrice: 0.42, outcomePrice: 0.42, count: 100,
  });
  assert.deepEqual(buildKalshiDemoOrderPlan(market, "no", "buy", 60), {
    side: "ask", yesPrice: 0.4, outcomePrice: 0.6, count: 100,
  });
});
