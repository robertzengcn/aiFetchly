/**
 * Loopback HTTP callback server for the desktop auth handoff.
 *
 * The desktop app starts this server on a random port on 127.0.0.1, gives
 * the resulting `http://127.0.0.1:<port>/auth/callback` URL to the web
 * app as the redirect_uri, and waits for the browser to be redirected
 * back with `?code=<code>&state=<state>`.
 *
 * The server validates the `state` against the pending handoff before
 * resolving the callback promise. A state mismatch (CSRF attempt) returns
 * HTTP 400 and rejects the callback promise with a typed error.
 *
 * The server binds to 127.0.0.1 ONLY — never to 0.0.0.0 or any external
 * interface — so only browser redirects originating on the same machine
 * can reach it.
 *
 * Lifecycle:
 *   - startLoopbackCallbackServer() returns a handle synchronously once
 *     listening succeeds, containing { port, redirectUri, waitForCallback,
 *     abort }.
 *   - waitForCallback() resolves with {code, state} on the first valid
 *     callback. Rejects on state mismatch, missing params, timeout, or
 *     abort(). The server is always closed before resolve/reject.
 *
 * Pure Node `http` module — no Electron APIs, safe to unit test.
 */

import * as http from "http";
import { isMatchingState, getPendingDesktopAuth } from "./pendingDesktopAuth";

/** Callback success payload — code + state, validated against pending auth. */
export type CallbackSuccess = {
  readonly code: string;
  readonly state: string;
};

/** Typed errors so callers can branch on user-facing messaging. */
export type CallbackError =
  | { kind: "state_mismatch" }
  | { kind: "missing_params" }
  | { kind: "no_pending_auth" }
  | { kind: "timeout" }
  | { kind: "aborted" }
  | { kind: "listen_error"; message: string };

/** Handle returned by startLoopbackCallbackServer. */
export type LoopbackServerHandle = {
  /** TCP port the server is listening on (ephemeral, 1024-65535). */
  readonly port: number;
  /** Full redirect URI to hand to the web app. */
  readonly redirectUri: string;
  /**
   * Resolves with {code, state} on the first valid callback, or rejects
   * with CallbackError on state mismatch, missing params, timeout, abort.
   * Server is always closed before settle.
   */
  waitForCallback: () => Promise<CallbackSuccess>;
  /** Stop the server and reject waitForCallback() with `aborted`. */
  abort: () => void;
};

/** Hard ceiling on the port number (IANA dynamic port upper bound). */
const MAX_PORT = 65535;
/** Min user-space port. Callback servers must not use privileged ports. */
const MIN_PORT = 1024;

/**
 * Starts the loopback callback server.
 *
 * On success returns a handle synchronously. Call `waitForCallback()` to
 * await the browser redirect; call `abort()` to cancel.
 *
 * @param timeoutMs - hard cap on how long waitForCallback() will wait
 *                    before rejecting with `timeout`. Default 5 minutes.
 */
export function startLoopbackCallbackServer(
  timeoutMs: number = 5 * 60 * 1000
): Promise<LoopbackServerHandle> {
  return new Promise<LoopbackServerHandle>((resolveStart, rejectStart) => {
    let callbackResolve: ((v: CallbackSuccess) => void) | null = null;
    let callbackReject: ((e: CallbackError) => void) | null = null;
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    /** Callback promise — created eagerly, resolved/rejected by the req handler. */
    const callbackPromise = new Promise<CallbackSuccess>((resolve, reject) => {
      callbackResolve = resolve;
      callbackReject = reject;
    });
    // Attach a no-op handler so that an abort/timeout without any observer
    // (i.e. waitForCallback() never called) does not surface as an unhandled
    // rejection. Callers that DO call waitForCallback() get their own copy
    // of the same promise and observe the rejection normally.
    callbackPromise.catch(function noopRejectionSwallow() {
      /* intentional no-op — see comment above */
    });

    const server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        // Only handle GET /auth/callback. Anything else is attacker noise.
        if (!req.url || !req.url.startsWith("/auth/callback")) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }

        const parsed = new URL(req.url, "http://127.0.0.1");
        const code = parsed.searchParams.get("code");
        const state = parsed.searchParams.get("state");
        const error = parsed.searchParams.get("error");

        // Handle provider-style `?error=...` (e.g. user denied consent upstream).
        // Not currently produced by our flow, but be defensive.
        if (error) {
          res.statusCode = 400;
          res.end("error");
          if (!settled) {
            settled = true;
            cleanup();
            callbackReject?.({
              kind: "missing_params",
              message: `callback reported error: ${error}`,
            } as CallbackError);
          }
          return;
        }

        if (!code || !state) {
          res.statusCode = 400;
          res.end("missing code or state");
          // Don't reject the promise — this could be a browser preflight or
          // an attacker probe. Stay alive for the real callback.
          return;
        }

        // Confirm there's still a pending handoff to match against.
        const pending = getPendingDesktopAuth();
        if (!pending) {
          res.statusCode = 400;
          res.end("no pending auth");
          if (!settled) {
            settled = true;
            cleanup();
            callbackReject?.({ kind: "no_pending_auth" });
          }
          return;
        }

        // Validate state against the pending handoff (CSRF defense).
        if (!isMatchingState(state)) {
          res.statusCode = 400;
          res.end("state mismatch");
          if (!settled) {
            settled = true;
            cleanup();
            callbackReject?.({ kind: "state_mismatch" });
          }
          return;
        }

        // Success — respond to the browser, then resolve.
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          "<html><body style='font-family:sans-serif;text-align:center;padding:2em'>" +
            "<h2>Login successful</h2><p>You can close this tab and return to the app.</p>" +
            "</body></html>"
        );

        if (!settled) {
          settled = true;
          cleanup();
          callbackResolve?.({ code, state });
        }
      }
    );

    // Bind to 127.0.0.1 only. Listening on :: or 0.0.0.0 would expose the
    // callback port to other machines on the LAN.
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (!settled) {
        settled = true;
        rejectStart({
          kind: "listen_error",
          message: err.message,
        } as CallbackError);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        rejectStart({
          kind: "listen_error",
          message: "server address unavailable",
        } as CallbackError);
        return;
      }
      const port = addr.port;
      if (port < MIN_PORT || port > MAX_PORT) {
        server.close();
        rejectStart({
          kind: "listen_error",
          message: `ephemeral port ${port} out of allowed range`,
        } as CallbackError);
        return;
      }
      const redirectUri = `http://127.0.0.1:${port}/auth/callback`;

      const handle: LoopbackServerHandle = {
        port,
        redirectUri,
        waitForCallback: () => callbackPromise,
        abort: () => {
          if (!settled) {
            settled = true;
            cleanup();
            callbackReject?.({ kind: "aborted" });
          }
        },
      };

      // Start the hard timeout. unref so the timer doesn't keep the event
      // loop alive on app quit (abort()/cleanup will also clear it).
      timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          callbackReject?.({ kind: "timeout" });
        }
      }, timeoutMs);
      timeoutHandle.unref?.();

      resolveStart(handle);
    });

    function cleanup(): void {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      try {
        server.close();
      } catch {
        // already closed — fine
      }
    }
  });
}
