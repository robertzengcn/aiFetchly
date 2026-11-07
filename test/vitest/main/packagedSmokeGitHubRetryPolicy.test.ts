import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Policy module for the packaged smoke GF-1 git-free GitHub install retry
 * (run #717 failure, CI job 124422992607):
 *
 *   [packaged-smoke] git-free GitHub install: ok=false pluginRow=false
 *   sawGit=false errors=install failed:
 *   {"success":false,"errors":[{"code":"github-rate-limited",
 *   "message":"GitHub temporarily limited public archive requests. Wait and
 *   retry, or import a ZIP.","recoverable":true}]}
 *
 * The PRD classifies `github-rate-limited` as RECOVERABLE (FR-24) and §9.3
 * forbids ever sending auth tokens, so the harness retries whole install
 * attempts with backoff instead of tokenizing the archive client.
 * Loaded through createRequire + a narrow local type because the project
 * tsconfig (moduleResolution: node) cannot statically type .js scripts,
 * same pattern as verifyPackagedChildprocess.test.ts.
 */
interface PackagedSmokeRetryPolicy {
  readonly DEFAULT_MAX_INSTALL_ATTEMPTS: number;
  readonly RATE_LIMIT_RETRY_DELAYS_MS: readonly number[];
  isRecoverableGitHubRateLimit(
    pluginErrors: readonly unknown[] | null | undefined
  ): boolean;
  retryDelayMs(failedAttemptIndex: number): number;
}

const require = createRequire(import.meta.url);
const policy = require("../../../scripts/packagedSmokeRetryPolicy.js") as PackagedSmokeRetryPolicy;

/** Exact error payload recorded verbatim from the run #717 CI log. */
const RATE_LIMITED_ERRORS = [
  {
    code: "github-rate-limited",
    message:
      "GitHub temporarily limited public archive requests. Wait and retry, or import a ZIP.",
    recoverable: true,
  },
];

describe("packaged-smoke github-rate-limited retry policy", () => {
  it("retries the exact run #717 rate-limit payload", () => {
    expect(policy.isRecoverableGitHubRateLimit(RATE_LIMITED_ERRORS)).toBe(true);
  });

  it("retries recoverable rate limits regardless of message copy", () => {
    expect(
      policy.isRecoverableGitHubRateLimit([
        { code: "github-rate-limited", message: "probe-probe", recoverable: true },
      ])
    ).toBe(true);
  });

  it("never retries non-rate-limit or unrecoverable payloads", () => {
    // No errors array at all (IPC-level failure).
    expect(policy.isRecoverableGitHubRateLimit(undefined)).toBe(false);
    expect(policy.isRecoverableGitHubRateLimit(null)).toBe(false);
    expect(policy.isRecoverableGitHubRateLimit([])).toBe(false);
    // Different code, even when recoverable (e.g. source-timeout).
    expect(
      policy.isRecoverableGitHubRateLimit([
        { code: "source-timeout", message: "timed out", recoverable: true },
      ])
    ).toBe(false);
    // The rate-limit code without the recoverable flag is rejected so the
    // policy cannot drift away from the PRD §8.2 recoverability contract.
    expect(
      policy.isRecoverableGitHubRateLimit([
        { code: "github-rate-limited", message: "limited", recoverable: false },
      ])
    ).toBe(false);
    // Mixed payloads (rate limit + something else) stay non-retriable.
    expect(
      policy.isRecoverableGitHubRateLimit([
        ...RATE_LIMITED_ERRORS,
        { code: "ref-not-found", message: "bad ref", recoverable: true },
      ])
    ).toBe(false);
    // Malformed entries never count as retry signals.
    expect(
      policy.isRecoverableGitHubRateLimit([null, undefined, {}])
    ).toBe(false);
  });

  it("keeps the retry budget inside the 60-minute CI job (ci.yml package-smoke)", () => {
    // 1 initial attempt + one retry per delay entry.
    expect(policy.DEFAULT_MAX_INSTALL_ATTEMPTS).toBe(
      policy.RATE_LIMIT_RETRY_DELAYS_MS.length + 1
    );
    // Delays are ascending and strictly positive.
    for (let i = 1; i < policy.RATE_LIMIT_RETRY_DELAYS_MS.length; i++) {
      expect(policy.RATE_LIMIT_RETRY_DELAYS_MS[i]).toBeGreaterThan(
        policy.RATE_LIMIT_RETRY_DELAYS_MS[i - 1]
      );
    }
    // Idle waits only (app launches add ~1 min each) — keep under 6 min so
    // packaging (~25 min) + smoke + retries fits timeout-minutes: 60.
    const totalIdleMs = policy.RATE_LIMIT_RETRY_DELAYS_MS.reduce(
      (a, b) => a + b,
      0
    );
    expect(totalIdleMs).toBeLessThanOrEqual(6 * 60_000);
  });

  it("clamps arbitrary attempt indices to the delay table", () => {
    expect(policy.retryDelayMs(0)).toBe(policy.RATE_LIMIT_RETRY_DELAYS_MS[0]);
    expect(
      policy.retryDelayMs(policy.RATE_LIMIT_RETRY_DELAYS_MS.length)
    ).toBe(policy.RATE_LIMIT_RETRY_DELAYS_MS.at(-1));
    expect(policy.retryDelayMs(9999)).toBe(
      policy.RATE_LIMIT_RETRY_DELAYS_MS.at(-1)
    );
    expect(policy.retryDelayMs(-5)).toBe(policy.RATE_LIMIT_RETRY_DELAYS_MS[0]);
  });
});
