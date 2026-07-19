"use strict";
/**
 * Renderer-side dev browser bridge configuration (PRD FR-3.2, technical design §11).
 *
 * The renderer learns where the bridge is from the Vite env var
 * `VITE_AIFETCHLY_DEV_BRIDGE_URL` (set in `.vscode/launch.json` / the dev
 * environment). This is a RENDERER module — `import.meta.env` is the correct
 * and supported pattern here (unlike the main-process bundle; see
 * src/config/viteLoginUrl.ts).
 *
 * The per-session token is NEVER baked in. The transport fetches it at runtime
 * from the origin-validated `/config` endpoint.
 */

/** Default loopback bridge URL when no override is supplied. */
export const DEFAULT_DEV_BROWSER_BRIDGE_URL = "http://127.0.0.1:37621";

/**
 * Bridge HTTP/WS path constants. These MUST match the server-side constants in
 * src/main-process/devtools/DevBrowserBridge.ts. They are duplicated here to
 * avoid importing main-process (node:http / ws) code into the renderer bundle.
 */
export const BRIDGE_PATH_INVOKE = "/__aifetchly_dev_bridge/invoke";
export const BRIDGE_PATH_CONFIG = "/__aifetchly_dev_bridge/config";
export const BRIDGE_PATH_EVENTS = "/__aifetchly_dev_bridge/events";

/** Resolve the dev browser bridge base URL (no trailing slash). */
export function getDevBrowserBridgeBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_AIFETCHLY_DEV_BRIDGE_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/+$/, "");
  }
  return DEFAULT_DEV_BROWSER_BRIDGE_URL;
}
