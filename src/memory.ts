import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ContingencyBasket, ExposureProfile, RiskOffsetCandidate, StoredExposure, UserProfile } from "./types.js";

const execFileAsync = promisify(execFile);
const dataDir = resolve(process.env.DATA_DIR ?? "./data");

function safeUserId(userId: string): string {
  const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  if (!safe) throw new Error("user_id must contain at least one letter or number");
  return safe;
}

function profilePath(userId: string) {
  return join(dataDir, "users", safeUserId(userId), "profile.json");
}

function bridgePath(): string {
  if (process.env.PROJECT_ROOT) return join(process.env.PROJECT_ROOT, "python", "mempalace_bridge.py");
  return resolve(process.cwd(), "python", "mempalace_bridge.py");
}

function pythonExecutable(): string {
  return process.env.MEMPALACE_PYTHON ?? resolve(process.cwd(), ".venv/bin/python");
}

function palacePath(): string {
  return process.env.MEMPALACE_PATH ?? join(homedir(), ".mempalace", "palace");
}

async function runMempalace(args: string[]) {
  const { stdout } = await execFileAsync(
    pythonExecutable(),
    [bridgePath(), ...args, "--palace", palacePath()],
    { timeout: 45_000, maxBuffer: 5 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as Record<string, unknown>;
}

export async function loadProfile(userId: string): Promise<UserProfile> {
  try {
    return JSON.parse(await readFile(profilePath(userId), "utf8")) as UserProfile;
  } catch {
    return { userId: safeUserId(userId), facts: [] };
  }
}

export async function remember(userId: string, text: string): Promise<UserProfile> {
  const profile = await loadProfile(userId);
  if (!profile.facts.some((fact) => fact.text.toLowerCase() === text.trim().toLowerCase())) {
    profile.facts.push({ text: text.trim(), createdAt: new Date().toISOString() });
  }
  const path = profilePath(userId);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return profile;
}

async function saveProfile(profile: UserProfile): Promise<void> {
  const path = profilePath(profile.userId);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}

export async function saveExposure(profile: ExposureProfile): Promise<void> {
  const userProfile = await loadProfile(profile.userId);
  const exposures = userProfile.exposures ?? [];
  const existing = exposures.find((item) => item.profile.id === profile.id);
  if (existing) existing.profile = profile;
  else exposures.push({ profile, baskets: [] });
  userProfile.exposures = exposures;
  await saveProfile(userProfile);
}

export async function loadExposure(userId: string, exposureId: string): Promise<StoredExposure | null> {
  const profile = await loadProfile(userId);
  return profile.exposures?.find((item) => item.profile.id === exposureId) ?? null;
}

export async function saveRiskOffsets(userId: string, exposureId: string, candidates: RiskOffsetCandidate[]): Promise<void> {
  const profile = await loadProfile(userId);
  const stored = profile.exposures?.find((item) => item.profile.id === exposureId);
  if (!stored) throw new Error("Exposure not found. Analyze and save an exposure first.");
  stored.candidates = candidates;
  stored.searchedAt = new Date().toISOString();
  await saveProfile(profile);
}

export async function saveBasket(userId: string, exposureId: string, basket: ContingencyBasket): Promise<void> {
  const profile = await loadProfile(userId);
  const stored = profile.exposures?.find((item) => item.profile.id === exposureId);
  if (!stored) throw new Error("Exposure not found. Analyze and save an exposure first.");
  stored.baskets = [...(stored.baskets ?? []), basket];
  await saveProfile(profile);
}

export async function rememberWithMempalace(userId: string, text: string) {
  const profile = await remember(userId, text);
  try {
    const mempalace = await runMempalace(["store", "--user", userId, "--text", text]);
    if (mempalace.error) throw new Error(String(mempalace.error));
    return { profile, mempalace, mempalaceAvailable: true };
  } catch (error) {
    return {
      profile,
      mempalaceAvailable: false,
      mempalaceError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function recall(userId: string, query: string, limit = 5) {
  const profile = await loadProfile(userId);
  const queryTokens = new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const local = profile.facts
    .map((fact) => ({
      text: fact.text,
      source: "local-profile",
      similarity: (fact.text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
        .filter((token) => queryTokens.has(token)).length,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  try {
    const payload = await runMempalace([
      "recall", "--user", userId, "--query", query, "--limit", String(limit),
    ]) as {
      results?: Array<{ text: string; similarity: number; wing: string; room: string }>;
      error?: string;
    };
    if (payload.error) throw new Error(payload.error);
    const mempalace = (payload.results ?? []).map((item) => ({ ...item, source: "mempalace" }));
    return { memories: [...mempalace, ...local].slice(0, limit), mempalaceAvailable: true };
  } catch (error) {
    return {
      memories: local,
      mempalaceAvailable: false,
      mempalaceError: error instanceof Error ? error.message : String(error),
    };
  }
}
