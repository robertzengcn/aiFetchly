/**
 * Diagnostic redaction for E2E failure artifacts (design §16.2).
 *
 * Pure functions — unit-tested independently of Playwright. The artifact
 * collector applies these before anything is written to the Playwright output
 * directory or attached to a failed test.
 *
 * Redacts: authorization/cookie headers, api keys/tokens/passwords/proxy
 * credentials, full prompts + reasoning text, base64 payloads, and absolute
 * paths outside the E2E root. Keeps: event type, content length, model/tool
 * name, status, timing, test-relative paths.
 */

/** Paths inside this root are kept; absolute paths outside are redacted. */
export function redactExternalPaths(input: string, rootPath: string): string {
  if (!input) return input;
  // Match absolute unix paths or Windows drive paths as standalone tokens.
  return input.replace(
    /(?:\/[^\s"'`,)\]]+|[A-Za-z]:\\[^\s"'`,)\]]+)/g,
    (absPath) => {
      if (absPath.startsWith(rootPath)) return absPath;
      // Common non-secret system/temp paths are safe to keep for diagnostics.
      if (/^\/(tmp|var|usr|bin|opt|proc|dev)/.test(absPath)) return absPath;
      return "<external-path>";
    }
  );
}

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(Authorization)\s*[:=]\s*Bearer\s+\S+/gi,
  /\b(Authorization)\s*[:=]\s*[^\s,}"']+/gi,
  /\b(Cookie)\s*[:=]\s*[^\s,}"']+/gi,
  /\b(X-Api-Key|Api-Key|apikey|api_key)\s*[:=]\s*[^\s,}"']+/gi,
  /\b(token|access_token|refresh_token|id_token)\s*[:=]\s*[^\s,}"']+/gi,
  /\b(password|passwd|secret|client_secret)\s*[:=]\s*[^\s,}"']+/gi,
  /\b(proxy[-_]?url)\s*[:=]\s*[^\s,}"']+/gi,
];

/** Redact credential-shaped key=value / header lines. */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match) => {
      const eq = match.match(/[:=]/);
      if (!eq) return "<redacted>";
      const idx = match.indexOf(eq[0]);
      return `${match.slice(0, idx + 1)} <redacted>`;
    });
  }
  // Bearer tokens in arbitrary positions: `Bearer ey...` -> `Bearer <redacted>`
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/g, "Bearer <redacted>");
  // JWT-shaped tokens (three base64 segments).
  out = out.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    "<jwt>"
  );
  return out;
}

/** Collapse long base64 / data URLs to a length placeholder. */
export function redactBase64(input: string, threshold = 120): string {
  if (!input) return input;
  return input
    .replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, (m) =>
      m.length <= threshold
        ? m
        : `${m.slice(0, threshold)}...<base64 len=${m.length}>`
    )
    .replace(/\b[A-Za-z0-9+/]{200,}={0,2}\b/g, (m) =>
      m.length <= 400 ? m : `<base64 len=${m.length}>`
    );
}

/** Apply all redactions in the canonical order. */
export function redactDiagnostics(input: string, rootPath: string): string {
  if (!input) return input;
  let out = redactSecrets(input);
  out = redactBase64(out);
  out = redactExternalPaths(out, rootPath);
  return out;
}
