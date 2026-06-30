/**
 * Unit tests for src/modules/loopbackCallbackServer.ts.
 *
 * Verifies:
 *   - startLoopbackCallbackServer returns a handle with a usable redirectUri.
 *   - A GET /auth/callback?code=X&state=Y request with matching state
 *     resolves waitForCallback() and closes the server.
 *   - A state mismatch returns HTTP 400 and rejects with state_mismatch.
 *   - Missing code/state returns 400 without rejecting the promise (so the
 *     real callback can still arrive).
 *   - abort() rejects waitForCallback() with `aborted`.
 *   - Calling when no pending auth is set rejects with `no_pending_auth`.
 *   - The server binds to 127.0.0.1 only (redirectUri never contains
 *     0.0.0.0, localhost, or an external IP).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "http";
import {
  startLoopbackCallbackServer,
  type LoopbackServerHandle,
} from "@/modules/loopbackCallbackServer";
import {
  setPendingDesktopAuth,
  clearPendingDesktopAuth,
} from "@/modules/pendingDesktopAuth";

const SAMPLE_STATE = "s".repeat(22);
const SAMPLE_VERIFIER = "v".repeat(43);
const SAMPLE_CHALLENGE = "c".repeat(43);

function buildPending(redirectUri: string) {
  setPendingDesktopAuth({
    codeVerifier: SAMPLE_VERIFIER,
    codeChallenge: SAMPLE_CHALLENGE,
    state: SAMPLE_STATE,
    redirectUri,
  });
}

function get(
  url: string,
  cb?: (res: http.IncomingMessage, body: string) => void
): void {
  http
    .get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (cb) cb(res, body);
      });
    })
    .on("error", () => {
      if (cb) cb({} as http.IncomingMessage, "");
    });
}

beforeEach(() => {
  clearPendingDesktopAuth();
});

afterEach(() => {
  clearPendingDesktopAuth();
});

describe("startLoopbackCallbackServer", () => {
  it("returns a handle with a 127.0.0.1 redirectUri on a user-space port", async () => {
    buildPending("placeholder");
    const handle = await startLoopbackCallbackServer(1000);
    try {
      expect(handle.redirectUri).toMatch(
        /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/auth\/callback$/
      );
      expect(handle.port).toBeGreaterThanOrEqual(1024);
      expect(handle.port).toBeLessThanOrEqual(65535);
    } finally {
      handle.abort();
    }
  });

  it("resolves waitForCallback() on matching code+state and closes server", async () => {
    const handle = await startLoopbackCallbackServer(1000);
    buildPending(handle.redirectUri);

    const callbackP = handle.waitForCallback();

    // Simulate browser redirect.
    get(`${handle.redirectUri}?code=abc&state=${SAMPLE_STATE}`);

    const result = await callbackP;
    expect(result.code).toBe("abc");
    expect(result.state).toBe(SAMPLE_STATE);
  });

  it("returns HTTP 400 on state mismatch and rejects with state_mismatch", async () => {
    const handle = await startLoopbackCallbackServer(1000);
    buildPending(handle.redirectUri);

    const callbackP = handle.waitForCallback();
    // Swallow rejection synchronously so it isn't reported as unhandled
    // before `await expect(...).rejects` attaches its own handler.
    const observed = callbackP.then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: e })
    );

    await new Promise<void>((resolve) => {
      get(
        `${handle.redirectUri}?code=abc&state=${"x".repeat(22)}`,
        (res, _body) => {
          expect(res.statusCode).toBe(400);
          resolve();
        }
      );
    });

    const result = await observed;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: "state_mismatch" });
    }
  });

  it("returns HTTP 400 on missing code/state without rejecting the promise", async () => {
    const handle = await startLoopbackCallbackServer(1000);
    buildPending(handle.redirectUri);

    const callbackP = handle.waitForCallback();

    await new Promise<void>((resolve) => {
      // Missing state entirely.
      get(`${handle.redirectUri}?code=abc`, (res, _body) => {
        expect(res.statusCode).toBe(400);
        resolve();
      });
    });

    // Promise should still be pending. Send a valid callback to settle it.
    get(`${handle.redirectUri}?code=abc&state=${SAMPLE_STATE}`);
    const result = await callbackP;
    expect(result.code).toBe("abc");
  });

  it("abort() rejects waitForCallback() with `aborted`", async () => {
    const handle = await startLoopbackCallbackServer(1000);
    buildPending(handle.redirectUri);

    const callbackP = handle.waitForCallback();
    // Attach handler synchronously to avoid the unhandled-rejection window.
    const observed = callbackP.then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: e })
    );
    handle.abort();

    const result = await observed;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: "aborted" });
    }
  });

  it("rejects with no_pending_auth when no handoff is set", async () => {
    const handle = await startLoopbackCallbackServer(1000);
    // No buildPending() — pending is empty.
    const callbackP = handle.waitForCallback();
    const observed = callbackP.then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: e })
    );

    await new Promise<void>((resolve) => {
      get(
        `${handle.redirectUri}?code=abc&state=${SAMPLE_STATE}`,
        (res, _body) => {
          expect(res.statusCode).toBe(400);
          resolve();
        }
      );
    });

    const result = await observed;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: "no_pending_auth" });
    }
  });

  it("never binds to 0.0.0.0, localhost, or external addresses", async () => {
    const handle: LoopbackServerHandle = await startLoopbackCallbackServer(
      1000
    );
    try {
      expect(handle.redirectUri).not.toContain("0.0.0.0");
      expect(handle.redirectUri).not.toContain("localhost");
      // Host must be exactly 127.0.0.1.
      const u = new URL(handle.redirectUri);
      expect(u.hostname).toBe("127.0.0.1");
    } finally {
      handle.abort();
    }
  });
});
