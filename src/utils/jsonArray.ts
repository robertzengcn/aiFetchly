/**
 * Parses a JSON column that stores a string array. Returns [] for null,
 * malformed or non-array payloads; non-string entries are dropped.
 */
export function parseStringArrayJson(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}
