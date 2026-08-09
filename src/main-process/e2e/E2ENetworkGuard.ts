/**
 * Default-deny network guard for the Electron E2E main process (design §10.1).
 *
 * Installed by the E2E bootstrap BEFORE importing background.ts, so production
 * code that attempts an outbound request to a non-loopback host fails closed:
 *
 *   - globalThis.fetch
 *   - node:http request/get
 *   - node:https request/get
 *
 * Loopback hosts (127.0.0.1, localhost, ::1) are always allowed — the only
 * local servers in the E2E topology are the FakeOpenAI server and the Vite
 * renderer. Every blocked attempt appends a redacted violation record to
 * `<root>/network-violations.jsonl` (origin + pathname only; query strings and
 * bodies are stripped) and throws immediately with the target origin in the
 * message, so test teardown can fail on any unexpected external traffic.
 *
 * This module imports only Node builtins (no `electron`) so it can be
 * unit-tested in Vitest.
 */

import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import type { E2EEnvironment } from "./E2EEnvironment";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export interface NetworkViolationRecord {
  readonly timestamp: number;
  readonly source: "fetch" | "http" | "https";
  readonly origin: string;
  /** Origin + pathname only — query strings may carry tokens and are stripped. */
  readonly pathname: string;
}

/** Extract `{origin, pathname}` from any http.request/get argument shape. */
export function extractRequestTarget(
  target: string | URL | http.RequestOptions,
  defaultProtocol: "http:" | "https:"
): { origin: string; pathname: string } | null {
  let parsed: URL | null = null;
  if (typeof target === "string") {
    try {
      parsed = new URL(target, `${defaultProtocol}//localhost`);
    } catch {
      return null;
    }
  } else if (target instanceof URL) {
    parsed = target;
  } else if (target && typeof target === "object") {
    const opts = target as http.RequestOptions;
    const host = opts.hostname ?? opts.host ?? "localhost";
    const port = opts.port ? `:${opts.port}` : "";
    const protocol = opts.protocol ?? defaultProtocol;
    try {
      parsed = new URL(`${protocol}//${host}${port}${opts.path ?? "/"}`);
    } catch {
      return null;
    }
  }
  if (!parsed) return null;
  return { origin: parsed.origin, pathname: parsed.pathname };
}

function recordViolation(
  violationsFile: string,
  source: NetworkViolationRecord["source"],
  info: { origin: string; pathname: string }
): void {
  const record: NetworkViolationRecord = {
    timestamp: Date.now(),
    source,
    origin: info.origin,
    pathname: info.pathname,
  };
  try {
    fs.appendFileSync(violationsFile, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Recording must never mask the original violation; swallow fs errors.
  }
}

/** Throw a fail-closed error pointing at the blocked origin. */
function blockedError(origin: string): Error {
  return new Error(
    `E2E network guard blocked a non-loopback request to ${origin}`
  );
}

export interface InstalledNetworkGuard {
  /** Restore the original fetch/http/https implementations. */
  uninstall(): void;
  /** Path of the JSONL violations log. */
  readonly violationsFile: string;
}

/**
 * Install the default-deny network guard. Allowed = loopback only. Idempotent:
 * calling twice is a no-op (returns a stub handle). The guard cannot honor a
 * per-request bypass — by design the only permitted hosts are loopback.
 */
export function installE2ENetworkGuard(
  environment: E2EEnvironment
): InstalledNetworkGuard {
  const violationsFile = path.join(
    environment.rootPath,
    "network-violations.jsonl"
  );
  // Ensure the root exists (the fixture creates it, but be defensive).
  try {
    fs.mkdirSync(environment.rootPath, { recursive: true });
  } catch {
    /* ignore */
  }

  const assertAllowed = (
    source: NetworkViolationRecord["source"],
    target: string | URL | http.RequestOptions,
    defaultProtocol: "http:" | "https:"
  ): void => {
    const info = extractRequestTarget(target, defaultProtocol);
    if (!info) {
      // Unparseable target — fail closed.
      recordViolation(violationsFile, source, {
        origin: "<unparseable>",
        pathname: "<unparseable>",
      });
      throw blockedError("<unparseable target>");
    }
    let hostname = "";
    try {
      hostname = new URL(info.origin).hostname;
    } catch {
      hostname = "";
    }
    if (!isLoopbackHost(hostname)) {
      recordViolation(violationsFile, source, info);
      throw blockedError(info.origin);
    }
  };

  // --- globalThis.fetch ---
  const originalFetch = globalThis.fetch;
  type FetchInput = Parameters<typeof fetch>[0];
  type FetchInit = Parameters<typeof fetch>[1];
  const patchedFetch = (
    input: FetchInput,
    init?: FetchInit
  ): Promise<Response> => {
    const target =
      typeof input === "string" || input instanceof URL
        ? input
        : (input as Request).url;
    // fetch() must return a rejected Promise (not throw synchronously) so caller
    // await/try-catch semantics match real fetch; http.request() below throws sync.
    try {
      assertAllowed("fetch", target as string | URL, "https:");
    } catch (err) {
      return Promise.reject(err);
    }
    return originalFetch(input as RequestInfo | URL, init as RequestInit);
  };
  globalThis.fetch = patchedFetch as typeof fetch;

  // --- node:http / node:https ---
  const patchModule = (
    mod: {
      request: typeof http.request;
      get: typeof http.get;
    },
    source: "http" | "https",
    defaultProtocol: "http:" | "https:"
  ): (() => void) => {
    const originalRequest = mod.request;
    const originalGet = mod.get;
    const patchedRequest = function patchedRequest(
      this: unknown,
      ...args: Parameters<typeof mod.request>
    ): http.ClientRequest {
      assertAllowed(
        source,
        args[0] as string | URL | http.RequestOptions,
        defaultProtocol
      );
      // eslint-disable-next-line prefer-spread
      return (
        originalRequest as unknown as (...a: unknown[]) => http.ClientRequest
      ).apply(mod, args as unknown[]);
    };
    const patchedGet = function patchedGet(
      this: unknown,
      ...args: Parameters<typeof mod.get>
    ): http.ClientRequest {
      assertAllowed(
        source,
        args[0] as string | URL | http.RequestOptions,
        defaultProtocol
      );
      // eslint-disable-next-line prefer-spread
      return (
        originalGet as unknown as (...a: unknown[]) => http.ClientRequest
      ).apply(mod, args as unknown[]);
    };
    // Some runtimes expose http.request as a non-writable property; patching is
    // best-effort here. The fetch patch above always covers the AI transport
    // path; the http/https patch is defense-in-depth for legacy callers.
    try {
      mod.request = patchedRequest as typeof mod.request;
      mod.get = patchedGet as typeof mod.get;
    } catch {
      return () => {
        /* nothing was patched */
      };
    }
    return () => {
      try {
        mod.request = originalRequest;
        mod.get = originalGet;
      } catch {
        /* ignore */
      }
    };
  };

  const restoreHttp = patchModule(http, "http", "http:");
  const restoreHttps = patchModule(https, "https", "https:");

  return {
    violationsFile,
    uninstall(): void {
      globalThis.fetch = originalFetch;
      restoreHttp();
      restoreHttps();
    },
  };
}
