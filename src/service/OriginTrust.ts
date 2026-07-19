/**
 * OriginTrust — F1 follow-up helper for privileged IPC handlers.
 *
 * The F9 fix in background.ts decides whether a child BrowserWindow may
 * receive the privileged preload bridge, based on its origin. Privileged
 * IPC operations that amount to a security approval (e.g. MCP_TOOL_TRUST,
 * which can authorize spawning a local stdio child process) must apply the
 * same origin check on the *sender frame*: a compromised renderer or an
 * external frame must not be able to self-grant trust.
 *
 * The trusted set mirrors F9:
 *   - about: / file: / app: schemes (production + scaffolding)
 *   - the Vite dev-server origin (development)
 *
 * Anything else is untrusted.
 */

export interface OriginTrustOptions {
  /**
   * Override the dev-server URL (testability). When omitted, the helper reads
   * the electron-forge-injected global at runtime, falling back to undefined
   * in non-main-process environments (tests/CI).
   */
  devServerUrl?: string;
}

function readDevServerGlobal(): string | undefined {
  try {
    const v = (
      globalThis as { MAIN_WINDOW_VITE_DEV_SERVER_URL?: unknown }
    ).MAIN_WINDOW_VITE_DEV_SERVER_URL;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function isAppTrustedOrigin(
  url: string | undefined,
  options: OriginTrustOptions = {}
): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === "about:") return true;
  if (parsed.protocol === "file:") return true;
  if (parsed.protocol === "app:") return true;

  const devUrl = options.devServerUrl ?? readDevServerGlobal();
  if (devUrl) {
    try {
      if (parsed.origin === new URL(devUrl).origin) return true;
    } catch {
      /* malformed dev-server URL — ignore */
    }
  }
  return false;
}
