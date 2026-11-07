"use strict";

/**
 * Retry policy for the packaged smoke's GF-1 git-free GitHub install leg
 * (scripts/packaged-smoke.mjs).
 *
 * GitHub serves the public, unauthenticated archive requests that GF-1
 * exercises (zipball install of the smoke fixture repo) with a per-IP
 * quota. On GitHub-hosted shared runners that quota is frequently already
 * exhausted by other jobs on the same IP, and the app reports the failure
 * as a `github-rate-limited` PluginError that the PRD classifies as
 * RECOVERABLE (FR-24: retry guidance, no tokens — §9.3 never sends auth).
 *
 * The app itself never retries a rate limit for the user. The smoke
 * harness, however, must distinguish a code regression from transient IP
 * quota exhaustion before failing the GF-1 gate, so it reruns the whole
 * install attempt a bounded number of times with rising backoff —
 * consuming no more than ~6 minutes of idle waits inside a 60-minute
 * CI job budget (ci.yml package-smoke: timeout-minutes: 60).
 *
 * CommonJS (not ESM) so vitest tests can load it through createRequire
 * under the project's node10 tsconfig moduleResolution, exactly like
 * scripts/verify-packaged-childprocess.js.
 */

/** Idle delay (ms) before the next whole-attempt retry. Ascending. */
const RATE_LIMIT_RETRY_DELAYS_MS = [30_000, 90_000, 180_000];

/** Max install attempts: 1 initial try + one per delay entry. */
const DEFAULT_MAX_INSTALL_ATTEMPTS = RATE_LIMIT_RETRY_DELAYS_MS.length + 1;

/**
 * Decide whether a failed `plugin:install-from-source` result must be
 * retried. Returns true only when at least one plugin error is reported
 * and EVERY one of them is the known recoverable `github-rate-limited`
 * code with `recoverable: true`. Anything else (transport, manifest,
 * ref-not-found, unknown shapes) stays non-retriable so deterministic
 * failures still fail loud on the first attempt.
 *
 * @param {readonly unknown[] | null | undefined} pluginErrors
 *   The renderer-plugin `errors` array reported by the install result
 *   (`installResult.data.errors`), untyped because it crossed the IPC
 *   boundary from the packaged app.
 * @returns {boolean}
 */
function isRecoverableGitHubRateLimit(pluginErrors) {
  if (!Array.isArray(pluginErrors) || pluginErrors.length === 0) {
    return false;
  }
  return pluginErrors.every(
    (error) =>
      Boolean(error) &&
      error.code === "github-rate-limited" &&
      error.recoverable === true
  );
}

/**
 * Milliseconds to wait before the retry that follows a failed 0-based
 * attempt index. Clamped to the table so an unexpected attempt count can
 * never produce a negative/absent delay.
 *
 * @param {number} failedAttemptIndex
 * @returns {number}
 */
function retryDelayMs(failedAttemptIndex) {
  const index = Math.max(
    0,
    Math.min(failedAttemptIndex, RATE_LIMIT_RETRY_DELAYS_MS.length - 1)
  );
  return RATE_LIMIT_RETRY_DELAYS_MS[index];
}

module.exports = {
  DEFAULT_MAX_INSTALL_ATTEMPTS,
  RATE_LIMIT_RETRY_DELAYS_MS,
  isRecoverableGitHubRateLimit,
  retryDelayMs,
};
