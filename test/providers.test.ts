import assert from "node:assert/strict";
import test from "node:test";
import { polymarketEventSlug } from "../src/providers.js";

test("uses the Polymarket parent event slug instead of the market slug", () => {
  assert.equal(polymarketEventSlug({
    id: "2696760",
    slug: "0-ships-transit-hormuz-on-any-date-by-july-31-20260626172559970",
    events: [{ slug: "0-ships-transit-hormuz-on-any-date-byptpt-20260626172559966" }],
  }), "0-ships-transit-hormuz-on-any-date-byptpt-20260626172559966");
});
