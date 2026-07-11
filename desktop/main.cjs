const { app, BrowserWindow, Notification, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const http = require("node:http");

let window;
let serverProcess;
let lastAlertId;
const port = 3033;

function resources() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
}

function health() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/health`, (response) => { response.resume(); resolve(response.statusCode === 200); });
    request.on("error", () => resolve(false)); request.setTimeout(700, () => { request.destroy(); resolve(false); });
  });
}

function prepareMempalace() {
  const runtime = path.join(app.getPath("userData"), "runtime");
  const python = path.join(runtime, ".venv", "bin", "python");
  const ready = path.join(runtime, ".mempalace-ready");
  if (existsSync(python) && existsSync(ready)) return python;
  const probe = spawnSync("python3", ["--version"], { stdio: "ignore" });
  if (probe.status !== 0) return "python3";
  mkdirSync(runtime, { recursive: true });
  const install = () => {
    const pip = spawn(python, ["-m", "pip", "install", "--disable-pip-version-check", path.join(resources(), "vendor", "mempalace")], { stdio: "ignore" });
    pip.once("exit", (code) => { if (code === 0) writeFileSync(ready, new Date().toISOString()); });
  };
  if (existsSync(python)) install();
  else {
    const setup = spawn("python3", ["-m", "venv", path.join(runtime, ".venv")], { stdio: "ignore" });
    setup.once("exit", (code) => { if (code === 0) install(); });
  }
  return "python3";
}

async function startServer() {
  if (await health()) return;
  const root = resources();
  const server = app.isPackaged ? path.join(root, "server", "desktop-server.cjs") : path.join(root, "dist", "desktop-server.cjs");
  const ui = path.join(root, "ui");
  const data = path.join(app.getPath("userData"), "data");
  mkdirSync(data, { recursive: true });
  const executable = app.isPackaged ? process.execPath : process.execPath;
  serverProcess = spawn(executable, [server], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", MCP_TRANSPORT: "http", HOST: "127.0.0.1", PORT: String(port), DATA_DIR: data, PROJECT_ROOT: root, RISKOFF_UI_DIR: ui, MEMPALACE_PYTHON: prepareMempalace(), MEMPALACE_PATH: path.join(app.getPath("userData"), "mempalace") },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await health()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Riskoff local server did not start");
}

async function createWindow() {
  await startServer();
  window = new BrowserWindow({ width: 1240, height: 820, minWidth: 820, minHeight: 620, titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 16 }, backgroundColor: "#f3f4f1", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  await window.loadURL(`http://127.0.0.1:${port}`);
}

async function pollAlerts() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/alerts?user_id=local-user`);
    const alerts = (await response.json()).alerts ?? [];
    const newest = alerts[0];
    if (lastAlertId && newest && newest.id !== lastAlertId && Notification.isSupported()) {
      new Notification({ title: "Riskoff found a political-risk change", body: newest.title }).show();
    }
    lastAlertId = newest?.id;
  } catch { /* the next poll retries */ }
}

app.whenReady().then(async () => { await createWindow(); await pollAlerts(); setInterval(pollAlerts, 60_000).unref(); }).catch((error) => { console.error(error); app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (serverProcess) serverProcess.kill(); });
