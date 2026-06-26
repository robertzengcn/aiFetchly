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

const PATH_PATTERN = /(?:\/[\w.\-:@]+)+\/?|[A-Z]:\\[\w.\-:@]+\\?/g;

/**
 * Produces a telemetry-safe variant of the error message: absolute file
 * paths are replaced with `<path>` so that internal directory structures
 * are not leaked. The original message is preserved on the returned
 * object so callers can still surface the full text to the user.
 */
export function splitTelemetryMessage(err: Error): {
  message: string;
  telemetryMessage: string;
} {
  const message = err.message;
  const telemetryMessage = message.replace(PATH_PATTERN, "<path>");
  return { message, telemetryMessage };
}
