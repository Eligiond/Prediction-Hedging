import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
const RISK_WORDS = ["conflict", "sanction", "ban", "tariff", "invasion", "clash", "blockade", "election", "regulation", "military", "strike", "crisis", "dispute"];

export interface RiskAlert {
  id: string; timestamp: string; query: string; title: string; url: string;
  source: string; publishedAt: string | null; riskLevel: "watch" | "elevated";
  explanation: string; matchedTerms: string[];
}

function tokens(value: string) {
  const stop = new Set("the and for with from this that what your into about have will are was were how can".split(" "));
  return value.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !stop.has(word)) ?? [];
}

export async function searchPoliticalNews(query: string, limit = 12) {
  const focusedQuery = [...new Set(tokens(query))].slice(0, 10).join(" ");
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", focusedQuery);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", String(Math.min(limit, 50)));
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "datedesc");
  let articles: Array<Record<string, unknown>> = [];
  try {
    const response = await fetch(url, { headers: { "user-agent": "riskoff-mcp/0.2" }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`GDELT returned HTTP ${response.status}`);
    const payload = await response.json() as { articles?: Array<Record<string, unknown>> };
    articles = payload.articles ?? [];
  } catch {
    const rss = new URL("https://news.google.com/rss/search");
    rss.searchParams.set("q", `${focusedQuery} when:7d`); rss.searchParams.set("hl", "en-US"); rss.searchParams.set("gl", "US"); rss.searchParams.set("ceid", "US:en");
    const response = await fetch(rss, { headers: { "user-agent": "riskoff-mcp/0.2" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Web news search returned HTTP ${response.status}`);
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(await response.text()) as { rss?: { channel?: { item?: Record<string, unknown>[] | Record<string, unknown> } } };
    const items = parsed.rss?.channel?.item;
    articles = (Array.isArray(items) ? items : items ? [items] : []).slice(0, limit).map((item) => ({
      title: item.title, url: item.link,
      domain: typeof item.source === "object" ? (item.source as Record<string, unknown>)["#text"] : item.source,
      seendate: item.pubDate,
    }));
  }
  const queryTerms = [...new Set(tokens(query))];
  return articles.map((article) => {
    const title = String(article.title ?? "Untitled report");
    const titleTokens = tokens(title);
    const matchedTerms = queryTerms.filter((term) => titleTokens.includes(term));
    const riskMatches = RISK_WORDS.filter((term) => titleTokens.includes(term));
    const riskLevel = riskMatches.length > 0 ? "elevated" as const : "watch" as const;
    return {
      id: Buffer.from(String(article.url ?? title)).toString("base64url").slice(0, 32),
      timestamp: new Date().toISOString(), query, title,
      url: String(article.url ?? ""), source: String(article.domain ?? article.sourcecountry ?? "Web"),
      publishedAt: article.seendate ? String(article.seendate) : null, riskLevel,
      explanation: riskLevel === "elevated"
        ? `This report contains a political-risk signal (${riskMatches.join(", ")}) and overlaps with your exposure (${matchedTerms.join(", ") || "the monitored topic"}). Review the source before changing a paper position.`
        : `This report overlaps with the monitored exposure (${matchedTerms.join(", ") || "the topic"}), but no strong escalation term was detected.`,
      matchedTerms,
    } satisfies RiskAlert;
  }).filter((alert) => alert.url && alert.matchedTerms.length > 0);
}

export async function scanAndStoreAlerts(userId: string, query: string) {
  const fresh = await searchPoliticalNews(query);
  const path = join(dataDir, "users", safe(userId), "alerts.json");
  let existing: RiskAlert[] = [];
  try { existing = JSON.parse(await readFile(path, "utf8")) as RiskAlert[]; } catch { /* first scan */ }
  const alerts = [...new Map([...fresh, ...existing].map((alert) => [alert.url, alert])).values()].slice(0, 200);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(alerts, null, 2)}\n`, "utf8");
  return { query, searchedAt: new Date().toISOString(), newAlerts: fresh.length, alerts: alerts.slice(0, 30), source: "GDELT and Google News web search" };
}

export async function getAlerts(userId: string) {
  try { return JSON.parse(await readFile(join(dataDir, "users", safe(userId), "alerts.json"), "utf8")) as RiskAlert[]; }
  catch { return []; }
}

export async function runProactiveScans() {
  let users: string[] = [];
  try { users = await readdir(join(dataDir, "users")); } catch { return; }
  await Promise.all(users.map(async (userId) => {
    try {
      const profile = JSON.parse(await readFile(join(dataDir, "users", userId, "profile.json"), "utf8")) as { facts?: Array<{ text: string }> };
      const query = profile.facts?.slice(-4).map((fact) => fact.text).join(" ").slice(0, 250);
      if (query) await scanAndStoreAlerts(userId, query);
    } catch { /* a single user cannot stop the monitor */ }
  }));
}
