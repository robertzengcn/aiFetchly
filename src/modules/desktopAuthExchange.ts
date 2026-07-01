/**
 * Shared "consume an authorization code" pipeline.
 *
 * Both the loopback-callback path (primary) and the custom-scheme fallback
 * path reduce to the same sequence:
 *
 *   1. Read (code, state) from the incoming redirect.
 *   2. Validate `state` against the pending handoff.
 *   3. Resolve device fingerprint for the exchange request.
 *   4. POST /api/desktop-auth/exchange → tokens.
 *   5. completeDesktopLogin(...) → persist tokens, register device, nav.
 *   6. Clear the pending handoff.
 *
 * Centralizing it here means the loopback server and the deep-link handler
 * cannot drift apart in behaviour. Both paths call consumeDesktopAuthCode().
 *
 * Pure orchestration — no Electron window creation, no DB access of its own.
 * The BrowserWindow is passed in so the function can be invoked from either
 * the main window (custom-scheme) or a background task (loopback) without
 * reaching for module-level state.
 */

import type { BrowserWindow } from "electron";
import {
  getPendingDesktopAuth,
  clearPendingDesktopAuth,
  isMatchingState,
} from "@/modules/pendingDesktopAuth";
import { DesktopAuthApi } from "@/api/desktopAuthApi";
import { completeDesktopLogin } from "@/modules/desktopLoginCompletion";
import { DeviceFingerprintService } from "@/modules/deviceFingerprint";
import { log } from "@/modules/Logger";

/** Input required to consume an incoming authorization code. */
export type ConsumeCodeInput = {
  /** Authorization code from the redirect's ?code=. */
  readonly code: string;
  /** State from the redirect's ?state=. */
  readonly state: string;
  /** Window to receive navigation events; may be null if destroyed. */
  readonly win: BrowserWindow | null;
};

/** Typed outcome so callers can surface user-facing messaging. */
export type ConsumeCodeResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "no_pending_auth"
        | "state_mismatch"
        | "invalid_grant"
        | "network"
        | "server"
        | "bad_response"
        | "completion_failed";
      message: string;
    };

/**
 * Validate state, exchange the code for tokens, and complete login.
 *
 * Always clears the pending handoff on terminal outcomes (success or
 * failure), so the same code/state cannot be replayed.
 *
 * Does NOT throw on expected failure modes — returns `{ ok: false }`
 * with a categorized reason. Unexpected exceptions propagate.
 */
export async function consumeDesktopAuthCode(
  input: ConsumeCodeInput
): Promise<ConsumeCodeResult> {
  const { code, state, win } = input;

  log.info("[consumeDesktopAuthCode] step 1: validate pending auth");

  // 1. Validate state against the pending handoff (CSRF defense).
  const pending = getPendingDesktopAuth();
  if (!pending) {
    const message =
      "Login session not found. Please sign in again from the app.";
    log.error("[consumeDesktopAuthCode] no pending desktop auth handoff");
    return { ok: false, reason: "no_pending_auth", message };
  }
  if (!isMatchingState(state)) {
    const message = "Login verification failed. Please sign in again.";
    log.error(
      "[consumeDesktopAuthCode] state mismatch — possible CSRF attempt"
    );
    // Clear on mismatch — the pending handoff is now suspect.
    clearPendingDesktopAuth();
    return { ok: false, reason: "state_mismatch", message };
  }

  // Capture the verifier + redirectUri, then clear pending BEFORE the
  // network exchange. This closes the TOCTOU window: a concurrent callback
  // (e.g. from a replay) will find no pending handoff and fail fast.
  const { codeVerifier, redirectUri } = pending;
  clearPendingDesktopAuth();

  log.info("[consumeDesktopAuthCode] step 2: resolve device fingerprint");

  // 2. Resolve device fingerprint.
  let deviceIdHash: string;
  let deviceName: string;
  try {
    const deviceFingerprintService = new DeviceFingerprintService();
    deviceIdHash = deviceFingerprintService.getDeviceIdHash();
    deviceName = deviceFingerprintService.getDeviceName();
  } catch (fingerprintErr) {
    const errMsg =
      fingerprintErr instanceof Error
        ? fingerprintErr.message
        : safeStringify(fingerprintErr);
    log.error("[consumeDesktopAuthCode] device fingerprint failed", {
      error: errMsg,
    });
    return {
      ok: false,
      reason: "completion_failed",
      message: `Failed to resolve device info: ${errMsg}`,
    };
  }

  log.info("[consumeDesktopAuthCode] step 3: exchange code for tokens", {
    redirectUri,
    codePrefix: code.substring(0, 6) + "...",
  });

  // 3. Exchange the one-time code for tokens over HTTPS.
  const desktopAuthApi = new DesktopAuthApi();
  const exchangeResult = await desktopAuthApi.exchangeDesktopAuthorizationCode({
    clientId: "aifetchly-desktop",
    code,
    codeVerifier,
    redirectUri,
    deviceName,
    deviceIdHash,
  });

  if (!exchangeResult.ok) {
    log.error("[consumeDesktopAuthCode] exchange failed", {
      reason: exchangeResult.reason,
      message: exchangeResult.message,
    });
    return {
      ok: false,
      reason: exchangeResult.reason,
      message: exchangeMessageFor(exchangeResult.reason),
    };
  }

  log.info("[consumeDesktopAuthCode] step 4: complete desktop login", {
    expiresIn: exchangeResult.data.expiresIn,
    hasRefreshToken: !!exchangeResult.data.refreshToken,
    hasUser: !!exchangeResult.data.user,
  });

  // 4. Persist tokens + run the post-login cascade.
  let completion;
  try {
    completion = await completeDesktopLogin(win, {
      accessToken: exchangeResult.data.accessToken,
      refreshToken: exchangeResult.data.refreshToken,
      expiresIn: exchangeResult.data.expiresIn,
      refreshExpiresIn: exchangeResult.data.refreshExpiresIn,
    });
  } catch (completionErr) {
    const errMsg =
      completionErr instanceof Error
        ? completionErr.message
        : safeStringify(completionErr);
    log.error("[consumeDesktopAuthCode] completeDesktopLogin threw", {
      error: errMsg,
      stack: completionErr instanceof Error ? completionErr.stack : undefined,
    });
    return {
      ok: false,
      reason: "completion_failed",
      message: `Failed to complete sign-in: ${errMsg}`,
    };
  }

  if (!completion.ok) {
    log.error("[consumeDesktopAuthCode] completeDesktopLogin failed", {
      reason: completion.reason,
      message: completion.message,
    });
    return {
      ok: false,
      reason: "completion_failed",
      message: `Failed to complete sign-in: ${completion.message}`,
    };
  }

  log.info("[consumeDesktopAuthCode] step 5: login completed successfully");
  return { ok: true };
}

/**
 * Safely stringify any value (including non-Error objects, plain objects,
 * circular structures) for logging. Avoids the "[object Object]" problem.
 */
function safeStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Circular or non-serializable
    return Object.prototype.toString.call(value);
  }
}

/** Map exchange failure reasons to user-facing copy. */
function exchangeMessageFor(
  reason: "invalid_grant" | "network" | "server" | "bad_response"
): string {
  switch (reason) {
    case "invalid_grant":
      return "Login code is invalid, expired, or already used. Please sign in again.";
    case "network":
      return "Unable to reach the login server. Check your network and try again.";
    case "server":
    case "bad_response":
    default:
      return "Login could not be completed. Please try again.";
  }
}
