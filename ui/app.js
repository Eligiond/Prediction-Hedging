const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
const pct = (value) => `${value >= 0 ? "+" : ""}${Number(value || 0).toFixed(2)}%`;
let dashboard;

fetch("/api/config").then((response) => response.json()).then((config) => { $("#local-mcp-endpoint").value = config.localMcpEndpoint; }).catch(() => {});

async function startClaudeConnection() {
  const state = $("#claude-connection-state");
  const field = $("#claude-mcp-endpoint");
  const copy = $("#copy-claude-endpoint");
  const retry = $("#retry-claude-connection");
  state.textContent = "Preparing link"; state.className = "connection-state is-starting";
  field.value = "Preparing secure HTTPS link…"; copy.disabled = true; retry.hidden = true;
  try {
    const response = await fetch("/api/connections/claude/start", { method: "POST" });
    const connection = await response.json();
    if (!response.ok || connection.status !== "ready" || !connection.url) throw new Error(connection.error || "Could not create the HTTPS link");
    field.value = connection.url; copy.disabled = false;
    state.textContent = "HTTPS ready"; state.className = "connection-state is-ready";
    $("#claude-connection-help").textContent = "Ready for Claude. Leave OAuth Client ID and Client Secret blank.";
  } catch (error) {
    field.value = "HTTPS connection unavailable";
    state.textContent = "Needs attention"; state.className = "connection-state is-error";
    $("#claude-connection-help").textContent = error.message; retry.hidden = false;
  }
}

async function loadKalshiDemoStatus() {
  const response = await fetch("/api/settings/kalshi-demo");
  const status = await response.json();
  const state = $("#kalshi-demo-state");
  const form = $("#kalshi-demo-form");
  const summary = $("#kalshi-demo-summary");
  const disconnect = $("#disconnect-kalshi-demo");
  if (status.configured && status.connected !== false) {
    state.textContent = "Demo connected"; state.className = "connection-state is-ready";
    summary.hidden = false; summary.textContent = `Available mock cash ${money(status.balance)} · Portfolio ${money(status.portfolioValue)} · Key ${status.apiKeyHint}`;
    form.hidden = true; disconnect.hidden = false;
    $("#kalshi-demo-feedback").textContent = "Kalshi orders will be submitted to the official Demo exchange. Polymarket remains locally simulated.";
  } else {
    state.textContent = status.configured ? "Reconnect needed" : "Not connected";
    state.className = `connection-state ${status.configured ? "is-error" : ""}`;
    summary.hidden = true; form.hidden = false; disconnect.hidden = !status.configured;
    $("#kalshi-demo-feedback").textContent = status.error || "Use credentials created at demo.kalshi.co, not production credentials.";
  }
}

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active-view", view.id === button.dataset.view));
  const titles = { portfolio: ["Portfolio", "Marked to current Kalshi and Polymarket prices"], intelligence: ["Intelligence", "Source-linked political risk changes"], connections: ["Connections", "Use Riskoff from any MCP-capable assistant"] };
  [$("#page-title").textContent, $("#page-subtitle").textContent] = titles[button.dataset.view];
  if (button.dataset.view === "intelligence") loadAlerts();
}));

async function loadDashboard() {
  $("#loading").hidden = false; $("#portfolio-content").hidden = true;
  const response = await fetch(`/api/dashboard?user_id=${encodeURIComponent($("#user-id").value)}`);
  if (!response.ok) throw new Error("Could not load the paper portfolio");
  dashboard = await response.json(); const { summary } = dashboard;
  $("#equity").textContent = money(summary.equity); $("#cash").textContent = money(summary.cash);
  $("#position-count").textContent = summary.openPositions; $("#trade-count").textContent = summary.trades;
  $("#total-return").textContent = `${money(summary.totalPnl)} (${pct(summary.returnPct)})`;
  $("#total-return").classList.toggle("negative", summary.totalPnl < 0); $("#period-return").textContent = pct(summary.returnPct);
  renderPositions(); renderTrades(); drawChart(); $("#loading").hidden = true; $("#portfolio-content").hidden = false;
}

function renderPositions() {
  const host = $("#positions"); host.innerHTML = "";
  if (!dashboard.positions.length) { host.innerHTML = '<div class="empty">No open paper positions. Ask your AI assistant to research a hedge, then confirm a simulated trade.</div>'; return; }
  dashboard.positions.forEach((position) => {
    const row = document.createElement("div"); row.className = "row"; row.tabIndex = 0;
    const venue = position.executionMode === "kalshi-demo" ? "Kalshi Demo fill" : "Local simulation";
    row.innerHTML = `<div><div class="row-title">${escapeHtml(position.title)}</div><div class="row-sub">${venue} · ${position.outcome.toUpperCase()}</div></div><div><div class="cell-label">Current value</div><div class="cell-value">${money(position.currentValue)}</div></div><div><div class="cell-label">Avg / current</div><div class="cell-value">${money(position.averagePrice)} / ${money(position.lastPrice)}</div></div><div><div class="cell-label">Unrealized</div><div class="cell-value ${position.unrealizedPnl >= 0 ? "positive" : "negative"}">${money(position.unrealizedPnl)} (${pct(position.returnPct)})</div></div>`;
    row.addEventListener("click", () => showPosition(position)); host.append(row);
  });
}
function renderTrades() {
  const host = $("#trades"); host.innerHTML = "";
  if (!dashboard.trades.length) { host.innerHTML = '<div class="empty">Your confirmed paper trades will appear here with their simulated fill price.</div>'; return; }
  dashboard.trades.forEach((trade) => { const row=document.createElement("div"); row.className="row"; const venue=trade.executionMode==="kalshi-demo"?"Kalshi Demo fill":"Local simulation"; row.innerHTML=`<div><div class="row-title">${escapeHtml(trade.title)}</div><div class="row-sub">${venue} · ${new Date(trade.timestamp).toLocaleString()}</div></div><div><div class="cell-label">Action</div><div class="cell-value">${trade.side.toUpperCase()} ${trade.outcome.toUpperCase()}</div></div><div><div class="cell-label">Fill</div><div class="cell-value">${money(trade.price)}</div></div><div><div class="cell-label">Paper amount</div><div class="cell-value">${money(trade.notional)}</div></div>`; host.append(row); });
}
function drawChart() { const canvas=$("#performance-chart"), rect=canvas.getBoundingClientRect(), ratio=devicePixelRatio||1; canvas.width=rect.width*ratio; canvas.height=220*ratio; const ctx=canvas.getContext("2d"); ctx.scale(ratio,ratio); const data=dashboard.history.map(x=>x.equity); if(data.length===1)data.unshift(dashboard.summary.startingCash); const min=Math.min(...data)*.995,max=Math.max(...data)*1.005||1,pad=14; ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue("--accent"); ctx.lineWidth=2; ctx.beginPath(); data.forEach((v,i)=>{const x=pad+i*(rect.width-pad*2)/(data.length-1),y=pad+(max-v)*(220-pad*2)/(max-min||1);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke(); }
function showPosition(position){const venue=position.executionMode==="kalshi-demo"?"This order was confirmed by the official Kalshi Demo exchange using mock funds.":"This position is simulated locally by Riskoff and does not exist in an exchange account.";$("#detail-content").innerHTML=`<h2>${escapeHtml(position.title)}</h2><p>${venue}</p><p>The position holds the <strong>${position.outcome.toUpperCase()}</strong> outcome. Each share settles at $1 if that outcome resolves true and $0 otherwise.</p><dl><div><dt>Paper cost</dt><dd>${money(position.cost)}</dd></div><div><dt>Current value</dt><dd>${money(position.currentValue)}</dd></div><div><dt>Shares</dt><dd>${position.shares.toFixed(2)}</dd></div><div><dt>Unrealized result</dt><dd>${money(position.unrealizedPnl)}</dd></div></dl>${position.marketUrl?`<p><a href="${position.marketUrl}" target="_blank">Open the market</a></p>`:""}`;$("#detail-dialog").showModal()}
async function loadAlerts(){const r=await fetch(`/api/alerts?user_id=${encodeURIComponent($("#user-id").value)}`);renderAlerts((await r.json()).alerts||[])}
function renderAlerts(alerts){const host=$("#alerts");host.innerHTML=alerts.length?"":'<div class="empty">No political-risk alerts yet. Run a search for an exposure you want Riskoff to monitor.</div>';alerts.forEach(a=>{const el=document.createElement("article");el.className="alert";el.innerHTML=`<div class="alert-meta"><span>${escapeHtml(a.source)}</span><span class="${a.riskLevel==="elevated"?"risk-elevated":""}">${a.riskLevel}</span></div><h3><a href="${a.url}" target="_blank" rel="noreferrer">${escapeHtml(a.title)}</a></h3><p>${escapeHtml(a.explanation)}</p>`;host.append(el)})}
$("#scan-form").addEventListener("submit",async(e)=>{e.preventDefault();$("#scan-status").textContent="Searching current reporting...";const r=await fetch("/api/alerts/scan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({user_id:$("#user-id").value,query:$("#scan-query").value})});const d=await r.json();$("#scan-status").textContent=r.ok?`Found ${d.newAlerts} relevant reports. Sources are linked below.`:d.error; if(r.ok)renderAlerts(d.alerts)});
async function copyField(fieldSelector, button) { await navigator.clipboard.writeText($(fieldSelector).value); button.textContent="Copied"; setTimeout(()=>button.textContent="Copy",1200); }
$("#kalshi-demo-form").addEventListener("submit",async(event)=>{event.preventDefault();const button=event.currentTarget.querySelector("button[type=submit]");button.disabled=true;button.textContent="Verifying…";$("#kalshi-demo-feedback").textContent="Checking the credentials against Kalshi Demo…";const response=await fetch("/api/settings/kalshi-demo",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({apiKeyId:$("#kalshi-demo-key-id").value,privateKey:$("#kalshi-demo-private-key").value})});const result=await response.json();button.disabled=false;button.textContent="Connect Kalshi Demo";if(!response.ok){$("#kalshi-demo-feedback").textContent=result.error||"Could not connect Kalshi Demo";return;}$("#kalshi-demo-private-key").value="";await loadKalshiDemoStatus();});
$("#disconnect-kalshi-demo").addEventListener("click",async()=>{await fetch("/api/settings/kalshi-demo",{method:"DELETE"});await loadKalshiDemoStatus();});
$("#refresh").addEventListener("click",()=>loadDashboard().catch(showError));$("#user-id").addEventListener("change",()=>loadDashboard().catch(showError));$("#close-dialog").addEventListener("click",()=>$("#detail-dialog").close());$("#copy-claude-endpoint").addEventListener("click",(event)=>copyField("#claude-mcp-endpoint",event.currentTarget));$("#copy-local-endpoint").addEventListener("click",(event)=>copyField("#local-mcp-endpoint",event.currentTarget));$("#retry-claude-connection").addEventListener("click",startClaudeConnection);window.addEventListener("resize",()=>dashboard&&drawChart());
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c])}function showError(error){$("#loading").innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`}loadDashboard().catch(showError);startClaudeConnection();loadKalshiDemoStatus();
