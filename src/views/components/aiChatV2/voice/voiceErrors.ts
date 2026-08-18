/**
 * Voice recorder error classification (TODO P2).
 *
 * Maps browser `getUserMedia` / `MediaRecorder` / audio-decode failures to a
 * small, stable set of user-facing kinds so the composer can show a concise
 * translated message instead of a raw exception string. Pure (performs no DOM
 * access) so it is unit-testable with synthetic errors.
 *
 * Mapping rationale:
 *  - `NotAllowedError`/`SecurityError`: the user denied microphone permission.
 *  - `NotFoundError`/`OverconstrainedError`: no microphone satisfies the
 *    request (no device, or constraints can't be met).
 *  - `NotSupportedError` or a message mentioning mime/codec: MediaRecorder
 *    cannot produce a supported audio type.
 *  - anything else: a generic recorder/recording failure.
 *
 * Conversion (WebM -> WAV decode/resample) failures are surfaced separately
 * by the caller as `conversion_failed` since they originate in
 * `audioConversion.ts`, not the recorder.
 */

export type VoiceRecorderErrorKind =
  | "permission_denied"
  | "no_microphone"
  | "unsupported_mime"
  | "recording_failed"
  | "conversion_failed"
  | "unknown";

/** Names of DOMExceptions thrown when the user blocks microphone access. */
const PERMISSION_NAMES = new Set([
  "NotAllowedError",
  "SecurityError",
]);

/** Names of DOMExceptions thrown when no suitable microphone exists. */
const NO_DEVICE_NAMES = new Set([
  "NotFoundError",
  "OverconstrainedError",
  "DevicesNotFoundError",
]);

/** Message substring hints that point at an unsupported audio type. */
const UNSUPPORTED_RE = /mime|codec|not.?supported|unsupported/i;

/**
 * Classify a recorder error into a stable kind. Falls back to `"unknown"` for
 * anything it cannot confidently map; callers render that as a generic
 * "recording failed" message.
 */
export function classifyRecorderError(err: unknown): VoiceRecorderErrorKind {
  if (err instanceof DOMException) {
    if (PERMISSION_NAMES.has(err.name)) return "permission_denied";
    if (NO_DEVICE_NAMES.has(err.name)) return "no_microphone";
    if (err.name === "NotSupportedError") return "unsupported_mime";
    return "unknown";
  }
  const message = err instanceof Error ? err.message : String(err);
  if (UNSUPPORTED_RE.test(message)) return "unsupported_mime";
  return "unknown";
}
