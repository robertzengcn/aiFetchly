/**
 * G02 — standard MCP progress shaping.
 *
 * The SDK forwards every `notifications/progress` it accepts; a hostile or
 * chatty server can push hundreds per second. The host must:
 *
 *   1. coalesce delivery to AT MOST `MCP_PROGRESS_MAX_PER_SECOND` events
 *      per second, preserving the most recent update per coalesced window
 *      (trailing-edge), so the terminal state is never lost to a dropped
 *      older event;
 *   2. redact secret-bearing content from page/server-supplied strings and
 *      bound their length BEFORE any registry/renderer/log delivery — the
 *      message is displayed data, never an instruction;
 *   3. normalize `progress > total` by clamping the reported fraction so
 *      the renderer never shows impossible progress.
 */

/** Delivery ceiling for standard MCP progress events. */
export const MCP_PROGRESS_MAX_PER_SECOND = 4;

/** Redaction ceiling for progress/notification message strings. */
export const MCP_PROGRESS_MESSAGE_MAX_CHARS = 200;

/**
 * Secret-shaped substrings are NEVER rendered: authorization headers,
 * api-key/password/token assignments, bare long token-like runs and
 * credentialed URLs. Control characters are dropped so a server cannot
 * forge log lines or terminal escape sequences.
 */
const SECRET_ASSIGNMENT_PATTERN =
  /(bearer\s+)[^\s"']{8,}/gi;

const KEY_VALUE_SECRET_PATTERN =
  /((?:api[_-]?key|secret|password|passwd|token|authorization|credential)s?\s*[:=]\s*)([^\s"'&;,]{6,})/gi;

const BARE_TOKEN_RUN_PATTERN =
  /([A-Za-z0-9+/_=-]{28,})(%2B|%2F|%3D|={1,2})?/g;

const CREDENTIALED_URL_PATTERN =
  /([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi;

// eslint-disable-next-line no-control-regex -- redaction REMOVES control characters by design
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/g;

export function redactProgressText(
  message: string,
  maxChars: number = MCP_PROGRESS_MESSAGE_MAX_CHARS
): string {
  let bounded = message.slice(0, maxChars);
  bounded = bounded.replace(CONTROL_CHAR_PATTERN, "");
  bounded = bounded.replace(SECRET_ASSIGNMENT_PATTERN, "$1[redacted]");
  bounded = bounded.replace(KEY_VALUE_SECRET_PATTERN, "$1[redacted]");
  bounded = bounded.replace(CREDENTIALED_URL_PATTERN, "$1[redacted]@");
  // Replace long opaque runs LAST so redaction placeholders survive.
  let last: string;
  do {
    last = bounded;
    bounded = bounded.replace(BARE_TOKEN_RUN_PATTERN, "[redacted]");
  } while (bounded !== last);
  return bounded;
}
/**
 * Sliding-window delivery limiter: at most `maxPerSecond` emits in any
 * 1000 ms span; when the cap is reached the LATEST emit is retained and
 * flushed as soon as the window allows, so the freshest state wins.
 */
export class ProgressRateLimiter {
  private readonly emissionTimes: number[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly maxPerSecond: number = MCP_PROGRESS_MAX_PER_SECOND,
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Request delivery of one update. Runs `emit` immediately when the
   * window allows; otherwise retains it as the trailing-latest update and
   * seeks the earliest slot at which it can be delivered.
   */
  schedule(emit: () => void): void {
    if (this.disposed) return;
    const now = this.now();
    while (
      this.emissionTimes.length > 0 &&
      now - this.emissionTimes[0] >= 1000
    ) {
      this.emissionTimes.shift();
    }
    if (this.emissionTimes.length < this.maxPerSecond) {
      this.emissionTimes.push(now);
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      emit();
      return;
    }
    // Window full: retain only the latest update; flush at the opening of
    // the next slot (the queue's oldest entry + 1000 ms).
    const oldest = this.emissionTimes[0];
    const delay = Math.max(0, oldest + 1000 - now);
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.disposed) return;
      this.emissionTimes.shift();
      this.emissionTimes.push(this.now());
      emit();
    }, delay);
  }

  /** Drop any pending trailing update (call ends). */
  dispose(): void {
    this.disposed = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
