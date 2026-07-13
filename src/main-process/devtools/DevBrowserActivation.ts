"use strict";
/**
 * Dev Browser Bridge activation gate (PRD FR-1, NFR-1).
 *
 * Pure module — no Electron import — so it is fully unit-testable. The caller
 * (`background.ts`) supplies `isPackaged`, the process env, and the Vite
 * dev-server URL; this module decides whether the bridge may start and, if so,
 * returns the resolved configuration.
 *
 * Activation rules (all must hold):
 *   1. App is NOT packaged (FR-1.2). Packaged builds never start the bridge.
 *   2. `AIFETCHLY_DEV_BROWSER_BRIDGE === "1"` (FR-1.1). Explicit opt-in.
 *   3. Host is loopback (FR-1.3). Non-loopback hosts are rejected.
 *   4. An allowed origin can be derived (explicit env override or the Vite
 *      dev-server origin). Without it the bridge cannot validate request
 *      origin and stays disabled.
 */

/** Hosts that resolve to the loopback interface. */
export const LOOPBACK_HOSTS = Object.freeze(["127.0.0.1", "localhost", "::1"] as const);

/** Default port for the dev browser bridge. Chosen to be unlikely to collide. */
export const DEFAULT_DEV_BROWSER_PORT = 37621;

export interface DevBrowserBridgeConfig {
  /** Loopback host the HTTP/WS server binds to. */
  host: string;
  /** Port the HTTP/WS server binds to. */
  port: number;
  /**
   * Exact Origin allowed on requests (e.g. "http://localhost:5173").
   * Used for strict origin validation (FR-6.2).
   */
  allowedOrigin: string;
}

export interface DevBrowserActivationInput {
  isPackaged: boolean;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /**
   * The Vite dev-server URL electron-forge injects
   * (`MAIN_WINDOW_VITE_DEV_SERVER_URL`). Used to derive `allowedOrigin` when
   * no explicit override is supplied.
   */
  devServerUrl?: string;
}

export interface DevBrowserActivationResult {
  enabled: boolean;
  /** Human-readable reason. Always populated (also when enabled, for logging). */
  reason: string;
  config?: DevBrowserBridgeConfig;
}

function isLoopbackHost(host: string): boolean {
  return (LOOPBACK_HOSTS as readonly string[]).includes(host);
}

/**
 * Parse a port, returning `fallback` when the value is missing, non-numeric,
 * or outside the valid TCP range.
 */
function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
  return n;
}

/** Extract `${protocol}//${host}` (no path, no trailing slash) from a URL. */
function originFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return undefined;
  }
}

/**
 * Decide whether the dev browser bridge may start, and resolve its config.
 * Pure function — no side effects, no Electron.
 */
export function resolveDevBrowserActivation(
  input: DevBrowserActivationInput
): DevBrowserActivationResult {
  const { isPackaged, env, devServerUrl } = input;

  // FR-1.2: packaged builds never start the bridge, regardless of env.
  if (isPackaged) {
    return {
      enabled: false,
      reason: "Dev browser bridge disabled: application is packaged (production build).",
    };
  }

  // FR-1.1: explicit opt-in flag required.
  if (env.AIFETCHLY_DEV_BROWSER_BRIDGE !== "1") {
    return {
      enabled: false,
      reason:
        "Dev browser bridge disabled: AIFETCHLY_DEV_BROWSER_BRIDGE is not '1'.",
    };
  }

  // FR-1.3 / NFR-1: loopback binding only.
  const host = env.AIFETCHLY_DEV_BROWSER_BRIDGE_HOST ?? "127.0.0.1";
  if (!isLoopbackHost(host)) {
    return {
      enabled: false,
      reason: `Dev browser bridge disabled: host '${host}' is not loopback. Only ${LOOPBACK_HOSTS.join(", ")} are permitted.`,
    };
  }

  // FR-6.2: a strict allowed origin is mandatory. Prefer the explicit override;
  // otherwise derive it from the real Vite dev-server URL.
  const explicitOrigin = env.AIFETCHLY_DEV_BROWSER_BRIDGE_ALLOWED_ORIGIN;
  const allowedOrigin =
    explicitOrigin && explicitOrigin.trim().length > 0
      ? explicitOrigin
      : devServerUrl
        ? originFromUrl(devServerUrl)
        : undefined;

  if (!allowedOrigin) {
    return {
      enabled: false,
      reason:
        "Dev browser bridge disabled: could not resolve allowed origin (set AIFETCHLY_DEV_BROWSER_BRIDGE_ALLOWED_ORIGIN or run under the Vite dev server).",
    };
  }

  const port = parsePort(env.AIFETCHLY_DEV_BROWSER_BRIDGE_PORT, DEFAULT_DEV_BROWSER_PORT);

  return {
    enabled: true,
    reason: `Dev browser bridge enabled on ${host}:${port} (allowed origin: ${allowedOrigin}).`,
    config: { host, port, allowedOrigin },
  };
}
