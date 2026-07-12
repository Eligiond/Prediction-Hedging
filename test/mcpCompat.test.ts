import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQualifiedToolCall } from "../src/mcpCompat.js";

test("strips the Codex connector namespace from qualified MCP tool calls", () => {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "riskoff.get_paper_portfolio", arguments: { user_id: "local-user" } },
  };
  assert.deepEqual(normalizeQualifiedToolCall(request), {
    ...request,
    params: { ...request.params, name: "get_paper_portfolio" },
  });
});

test("also accepts slash-qualified tool names", () => {
  const request = { method: "tools/call", params: { name: "riskoff/execute_paper_trade", arguments: {} } };
  assert.deepEqual(normalizeQualifiedToolCall(request), {
    method: "tools/call",
    params: { name: "execute_paper_trade", arguments: {} },
  });
});

test("leaves standard tool calls and non-call requests unchanged", () => {
  const standard = { method: "tools/call", params: { name: "get_paper_portfolio" } };
  const listing = { method: "tools/list", params: {} };
  assert.equal(normalizeQualifiedToolCall(standard), standard);
  assert.equal(normalizeQualifiedToolCall(listing), listing);
});
