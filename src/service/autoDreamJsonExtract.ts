/**
 * Extract a JSON object payload from a model completion.
 *
 * Hosted free/reasoning models often wrap the required consolidation JSON in
 * a preamble, a markdown fence, or both. `JSON.parse` on the raw string then
 * fails, the run is marked failed (or the creates are dropped), and the
 * Workspace Memory "Run Auto Summary" button looks like a no-op.
 */
export function extractJsonObject(raw: string): string {
  const s = raw.trim();
  if (!s) return "";

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? s).trim();
  if (!candidate) return "";

  if (isJsonObject(candidate)) return candidate;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = candidate.slice(start, end + 1).trim();
    if (isJsonObject(sliced)) return sliced;
    return sliced;
  }
  return candidate;
}

function isJsonObject(s: string): boolean {
  try {
    const v: unknown = JSON.parse(s);
    return typeof v === "object" && v !== null;
  } catch {
    return false;
  }
}
