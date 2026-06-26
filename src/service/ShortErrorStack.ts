const DEFAULT_MAX_FRAMES = 5;

/**
 * Returns the error's message + up to `maxFrames` stack frames joined
 * by newlines. Returns null when there is no stack.
 *
 * This is used to trim long Puppeteer/Node stacks (30+ frames) down
 * to a compact summary before they land in a tool_result and bloat
 * the model's context window.
 */
export function shortErrorStack(
  err: Error,
  maxFrames = DEFAULT_MAX_FRAMES
): string | null {
  if (!err.stack) return null;
  const lines = err.stack.split("\n");
  // First line is typically "ErrorName: message". Keep it, then up to N frames.
  const head = lines.slice(0, 1);
  const frames = lines.slice(1).slice(0, maxFrames);
  return [...head, ...frames].join("\n").trim();
}

/**
 * Matches absolute file paths (Unix or Windows) so they can be redacted.
 *
 * Two fixes applied:
 * - **URL protection**: Because a lookbehind alone cannot distinguish URL
 *   path segments (`example.com/api/v1`) from real file paths
 *   (`/home/user/file`), URLs are temporarily replaced with placeholders
 *   via `URL_PATTERN` before redaction and restored afterwards.
 * - **Windows spaces**: The Windows character class includes a space
 *   (`[\w.\-:@ ]+`) so paths like `C:\Program Files\app` are matched.
 */
const URL_PATTERN = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+/g;
const PATH_PATTERN = /(?:\/[\w.\-:@]+)+\/?|[A-Z]:\\(?:[\w.\-:@ ]+\\?)+/g;
// Delimiter tokens for masking URLs during path redaction. The double angle
// brackets are extremely unlikely to appear in real error messages.
const URL_PLACEHOLDER = /<<URL_(\d+)>>/g;

/**
 * Produces a telemetry-safe variant of the error message: absolute file
 * paths are replaced with `<path>` so that internal directory structures
 * are not leaked. URLs are preserved intact. The original message is
 * preserved on the returned object so callers can still surface the full
 * text to the user.
 */
export function splitTelemetryMessage(err: Error): {
  message: string;
  telemetryMessage: string;
} {
  const message = err.message;

  // Step 1: Temporarily mask URLs so their path-like segments are not
  // mistaken for filesystem paths.
  const urls: string[] = [];
  const masked = message.replace(URL_PATTERN, (match) => {
    const id = urls.length;
    urls.push(match);
    return `<<URL_${id}>>`;
  });

  // Step 2: Redact file paths.
  let telemetryMessage = masked.replace(PATH_PATTERN, "<path>");

  // Step 3: Restore the original URLs, but redact file:// URLs to prevent
  // local path leakage in telemetry.
  telemetryMessage = telemetryMessage.replace(URL_PLACEHOLDER, (_, n) => {
    const original = urls[Number(n)];
    if (original.startsWith("file://")) {
      return "<file-url>";
    }
    return original;
  });

  return { message, telemetryMessage };
}
