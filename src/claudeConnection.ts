import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import http, { type Server } from "node:http";

type ConnectionState = {
  status: "idle" | "starting" | "ready" | "error";
  url?: string;
  error?: string;
};

export class ClaudeConnection {
  private state: ConnectionState = { status: "idle" };
  private cloudflared?: ChildProcessWithoutNullStreams;
  private proxy?: Server;
  private startPromise?: Promise<ConnectionState>;

  constructor(
    private readonly mcpPort: number,
    private readonly cloudflaredPath = process.env.CLOUDFLARED_PATH,
  ) {}

  getState(): ConnectionState {
    return { ...this.state };
  }

  start(): Promise<ConnectionState> {
    if (this.state.status === "ready" && this.cloudflared && !this.cloudflared.killed) {
      return Promise.resolve(this.getState());
    }
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.cloudflared?.kill();
    this.cloudflared = undefined;
    if (this.proxy) await new Promise<void>((resolve) => this.proxy?.close(() => resolve()));
    this.proxy = undefined;
    this.state = { status: "idle" };
  }

  private async startInternal(): Promise<ConnectionState> {
    await this.stop();
    this.state = { status: "starting" };
    const cloudflaredPath = this.cloudflaredPath;
    if (!cloudflaredPath) {
      this.state = { status: "error", error: "The HTTPS connector is missing from this build. Reinstall the latest Riskoff DMG." };
      return this.getState();
    }

    const secret = randomBytes(24).toString("base64url");
    const publicPath = `/mcp/${secret}`;
    this.proxy = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname !== publicPath || !["POST", "GET", "DELETE", "OPTIONS"].includes(request.method ?? "")) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const headers = { ...request.headers, host: `127.0.0.1:${this.mcpPort}` };
      delete headers.origin;
      const upstream = http.request({
        hostname: "127.0.0.1",
        port: this.mcpPort,
        path: "/mcp",
        method: request.method,
        headers,
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Riskoff MCP is unavailable" }));
      });
      request.pipe(upstream);
    });

    const proxyPort = await new Promise<number>((resolve, reject) => {
      this.proxy?.once("error", reject);
      this.proxy?.listen(0, "127.0.0.1", () => {
        const address = this.proxy?.address();
        if (!address || typeof address === "string") reject(new Error("Could not allocate the secure connector port"));
        else resolve(address.port);
      });
    });

    return new Promise<ConnectionState>((resolve) => {
      let settled = false;
      let output = "";
      const finish = (state: ConnectionState) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.state = state;
        resolve(this.getState());
      };
      const inspect = (chunk: Buffer) => {
        output = `${output}${chunk.toString()}`.slice(-16_000);
        const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) finish({ status: "ready", url: `${match[0]}${publicPath}` });
      };

      const cloudflared = spawn(cloudflaredPath, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${proxyPort}`]);
      this.cloudflared = cloudflared;
      cloudflared.stdout.on("data", inspect);
      cloudflared.stderr.on("data", inspect);
      cloudflared.once("error", (error) => finish({ status: "error", error: `Could not start the HTTPS connector: ${error.message}` }));
      cloudflared.once("exit", (code) => {
        this.cloudflared = undefined;
        if (!settled) finish({ status: "error", error: `The HTTPS connector stopped before it was ready${code === null ? "." : ` (code ${code}).`}` });
        else if (this.state.status === "ready") this.state = { status: "error", error: "The HTTPS connection stopped. Reconnect to create a new link." };
      });
      const timeout = setTimeout(() => {
        this.cloudflared?.kill();
        finish({ status: "error", error: "Timed out creating the HTTPS connection. Check your internet connection and try again." });
      }, 30_000);
    });
  }
}
