/**
 * AIChatSummaryJsonParse — tolerant JSON extraction for compaction model
 * output (technical-design §10 / §16).
 *
 * Flash-tier models summarizing dense content (CSV, HTML, long tool receipts)
 * frequently ignore the "no prose outside the JSON" instruction and wrap the
 * SectionSummaryV1 object in a markdown code fence or surround it with prose.
 * The previous `JSON.parse(raw)` path silently returned `null` on every such
 * case, producing a root-level Zod failure (`schema: : Invalid input`) that
 * gave the bounded-retry loop no useful signal — so all 4 attempts failed
 * identically.
 *
 * This helper recovers the embedded JSON object when possible, and when it
 * cannot, surfaces the actual `JSON.parse` error message instead of swallowing
 * it. The coordinator feeds that error back to the model's repair prompt so
 * the single structured-output repair has actionable information.
 */

/** Result of attempting to extract a JSON object from raw model output. */
export interface ParsedSummaryJson {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
}

/**
 * Extract a JSON value from raw model output.
 *
 * Strategy (in order):
 *   1. Try `JSON.parse` directly — the common case when the model obeys the
 *      "raw JSON, no prose" instruction.
 *   2. If that fails, look for a markdown code fence (```json or ```) and
 *      parse the fenced content.
 *   3. If no fence is present, scan for the first balanced `{` … `}` object
 *      boundary and parse that slice (handles leading prose like "Sure! {...}").
 *
 * `JSON.parse` is strict about trailing content, so step 3 cannot just parse
 * from the first `{` — it balances braces (respecting string literals and
 * escapes) to find the matching close.
 *
 * The error returned on failure is the original `JSON.parse` message (or a
 * short diagnostic when no JSON object could be located). It is never empty.
 */
export function parseSummaryJson(raw: string): ParsedSummaryJson {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: "empty model output" };
  }

  // 1. Direct parse.
  const direct = tryParse(raw);
  if (direct.ok) return { ok: true, value: direct.value };

  // 2. Markdown code fence (```json ... ``` or ``` ... ```).
  const fenced = extractFenced(raw);
  if (fenced !== null) {
    const parsed = tryParse(fenced);
    if (parsed.ok) return { ok: true, value: parsed.value };
    // Fall through to brace scan; if that also fails, return the fenced
    // parse error (more specific than the direct-parse error).
    const braced = extractFirstBracedObject(fenced);
    if (braced !== null) {
      const inner = tryParse(braced);
      if (inner.ok) return { ok: true, value: inner.value };
    }
    return { ok: false, error: parsed.error };
  }

  // 3. Leading prose + bare JSON object (no fence).
  const braced = extractFirstBracedObject(raw);
  if (braced !== null) {
    const inner = tryParse(braced);
    if (inner.ok) return { ok: true, value: inner.value };
    return { ok: false, error: inner.error };
  }

  // No JSON object could be located at all.
  return {
    ok: false,
    error: direct.error ?? "no JSON object found in model output",
  };
}

/** Strict JSON.parse; returns the error message on failure. */
function tryParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Extract the content of the first markdown code fence. Returns `null` when
 * no fence is present. Handles ```json and bare ``` openings.
 */
function extractFenced(raw: string): string | null {
  const fenceOpen = raw.indexOf("```");
  if (fenceOpen === -1) return null;
  // Skip the opening backticks and optional language tag on the same line.
  let contentStart = fenceOpen + 3;
  // Swallow trailing chars until end-of-line (the language tag, e.g. "json").
  while (contentStart < raw.length && raw[contentStart] !== "\n") {
    contentStart += 1;
  }
  // Move past the newline.
  if (contentStart < raw.length) contentStart += 1;
  const fenceClose = raw.indexOf("```", contentStart);
  if (fenceClose === -1) {
    // Unclosed fence — treat the rest of the content as the fenced body.
    return raw.slice(contentStart).trim();
  }
  return raw.slice(contentStart, fenceClose).trim();
}

/**
 * Find the first balanced `{ ... }` object in `raw`, respecting string
 * literals and escape sequences so braces inside strings do not corrupt the
 * depth count. Returns the raw substring including the outer braces, or
 * `null` when no balanced object exists.
 */
function extractFirstBracedObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  // Truncated mid-object (depth never returned to 0) — return null so the
  // caller surfaces the parse error rather than slicing invalid JSON.
  return null;
}
