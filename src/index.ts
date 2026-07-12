import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { getDashboard } from "./dashboard.js";
import { getAlerts, runProactiveScans, scanAndStoreAlerts } from "./intelligence.js";
import { ClaudeConnection } from "./claudeConnection.js";
import { normalizeQualifiedToolCall } from "./mcpCompat.js";
import { configureKalshiDemo, disconnectKalshiDemo, getKalshiDemoStatus } from "./kalshiDemo.js";

async function startStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

async function startHttp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const origins = new Set((process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const token = process.env.MCP_API_TOKEN;
  const port = Number(process.env.PORT ?? 3000);
  const claudeConnection = new ClaudeConnection(port);

  app.use((request, response, next) => {
    const origin = request.headers.origin;
    const sameOrigin = origin === `http://${request.headers.host}` || origin === `https://${request.headers.host}`;
    if (origin && (sameOrigin || origins.has(origin))) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
    }
    response.setHeader("Access-Control-Allow-Headers", "content-type, authorization, mcp-session-id, last-event-id");
    response.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    if (request.method === "OPTIONS") return response.sendStatus(origin && !sameOrigin && !origins.has(origin) ? 403 : 204);
    if (origin && !sameOrigin && !origins.has(origin)) return response.status(403).json({ error: "Origin not allowed" });
    if (token && request.headers.authorization !== `Bearer ${token}`) return response.status(401).json({ error: "Unauthorized" });
    next();
  });

  app.get("/health", (_request, response) => response.json({ ok: true, service: "riskoff-mcp", mode: "paper-only" }));
  app.get("/api/dashboard", async (request, response) => {
    try { response.json(await getDashboard(String(request.query.user_id ?? "local-user"))); }
    catch (error) { response.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.get("/api/alerts", async (request, response) => response.json({ alerts: await getAlerts(String(request.query.user_id ?? "local-user")) }));
  app.post("/api/alerts/scan", async (request, response) => {
    try { response.json(await scanAndStoreAlerts(String(request.body.user_id ?? "local-user"), String(request.body.query ?? ""))); }
    catch (error) { response.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.get("/api/config", (_request, response) => response.json({ localMcpEndpoint: `http://127.0.0.1:${port}/mcp`, mode: "paper-only", proactiveIntervalMinutes: Number(process.env.MONITOR_INTERVAL_MINUTES ?? 15) }));
  app.get("/api/settings/kalshi-demo", async (_request, response) => response.json(await getKalshiDemoStatus()));
  app.post("/api/settings/kalshi-demo", async (request, response) => {
    try {
      response.json(await configureKalshiDemo({ apiKeyId: String(request.body.apiKeyId ?? ""), privateKey: String(request.body.privateKey ?? "") }));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.delete("/api/settings/kalshi-demo", async (_request, response) => {
    await disconnectKalshiDemo();
    response.json({ configured: false, environment: "kalshi-demo" });
  });
  app.get("/api/connections/claude", (_request, response) => response.json(claudeConnection.getState()));
  app.post("/api/connections/claude/start", async (_request, response) => {
    const state = await claudeConnection.start();
    response.status(state.status === "ready" ? 200 : 503).json(state);
  });
  app.delete("/api/connections/claude", async (_request, response) => {
    await claudeConnection.stop();
    response.json({ status: "idle" });
  });
  app.post("/mcp", async (request, response) => {
    const body = normalizeQualifiedToolCall(request.body);
    request.body = body;
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  });
  app.get("/mcp", (_request, response) => response.status(405).json({ error: "Stateless MCP accepts POST only" }));
  app.delete("/mcp", (_request, response) => response.status(405).json({ error: "Stateless MCP has no sessions" }));

  const host = process.env.HOST ?? "127.0.0.1";
  const uiDir = resolve(process.env.RISKOFF_UI_DIR ?? "ui");
  if (existsSync(uiDir)) app.use(express.static(uiDir));
  const monitorMinutes = Math.max(5, Number(process.env.MONITOR_INTERVAL_MINUTES ?? 15));
  const monitor = setInterval(() => { void runProactiveScans(); }, monitorMinutes * 60_000);
  monitor.unref();
  const shutdown = () => {
    const forcedExit = setTimeout(() => process.exit(0), 1_500);
    forcedExit.unref();
    void claudeConnection.stop().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  void runProactiveScans();
  app.listen(port, host, () => console.error(`Riskoff MCP and dashboard listening at http://${host}:${port}`));
}

const start = process.env.MCP_TRANSPORT === "http" ? startHttp : startStdio;
void start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
