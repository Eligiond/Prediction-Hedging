type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeQualifiedToolCall(body: unknown): unknown {
  if (!isRecord(body) || body.method !== "tools/call" || !isRecord(body.params)) return body;
  const name = body.params.name;
  if (typeof name !== "string") return body;
  const normalizedName = name.replace(/^riskoff[./]/i, "");
  if (normalizedName === name || !normalizedName) return body;
  return { ...body, params: { ...body.params, name: normalizedName } };
}
