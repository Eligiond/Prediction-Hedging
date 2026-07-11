import express from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

async function startStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

async function startHttp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const origins = new Set((process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const token = process.env.MCP_API_TOKEN;

  app.use((request, response, next) => {
    const origin = request.headers.origin;
    if (origin && origins.has(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
    }
    response.setHeader("Access-Control-Allow-Headers", "content-type, authorization, mcp-session-id, last-event-id");
    response.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    if (request.method === "OPTIONS") return response.sendStatus(origin && !origins.has(origin) ? 403 : 204);
    if (origin && !origins.has(origin)) return response.status(403).json({ error: "Origin not allowed" });
    if (token && request.headers.authorization !== `Bearer ${token}`) return response.status(401).json({ error: "Unauthorized" });
    next();
  });

  app.get("/health", (_request, response) => response.json({ ok: true, service: "prediction-hedging-mcp", mode: "paper-only" }));
  app.get("/", (_request, response) => response.type("html").send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prediction Hedging MCP</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10110f;color:#f4f0e6;font:16px system-ui,sans-serif}main{max-width:680px;padding:48px}b{color:#a9e66e}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#72d572;margin-right:9px}code{background:#24251f;padding:4px 7px;border-radius:5px}p{line-height:1.6;color:#c9c6bc}small{color:#8e8c84}</style>
<main><div><span class="dot"></span><b>RUNNING LOCALLY</b></div><h1>Prediction Hedging MCP</h1>
<p>Kalshi + Polymarket semantic search, personalized MemPalace context, and paper trading are available at <code>/mcp</code>.</p>
<p><strong>Paper mode only.</strong> No real-money orders can be placed.</p><small>Keep this terminal open. Press Control-C there to stop the server.</small></main></html>`));
  app.post("/mcp", async (request, response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  });
  app.get("/mcp", (_request, response) => response.status(405).json({ error: "Stateless MCP accepts POST only" }));
  app.delete("/mcp", (_request, response) => response.status(405).json({ error: "Stateless MCP has no sessions" }));

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(port, host, () => console.error(`Prediction Hedging MCP listening at http://${host}:${port}/mcp`));
}

if (process.env.MCP_TRANSPORT === "http") await startHttp();
else await startStdio();
