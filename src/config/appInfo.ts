/**
 * Public, non-secret application identity constants.
 *
 * These describe the product to the user (About page, website link) and to the
 * GitHub auto-update feed. They contain no credentials and are safe to import
 * from either the renderer or the main process.
 */

/**
 * Fallback product / company website opened from the About page.
 *
 * The About page prefers `VITE_LOGIN_URL` (the marketing-site base configured
 * in `.env` at build time) and falls back to this constant when that variable
 * is missing or invalid. Keep this in sync with `.env.example` so packaged
 * builds without an embedded URL still open a sensible page.
 */
export const AIFETCHLY_WEBSITE_URL = "https://www.sellart-online.com";

/**
 * Resolve the About-page website URL from a raw `VITE_LOGIN_URL` value.
 *
 * Pure and safe to import from either the renderer or the main process
 * (no `import.meta` / `process.env` access here — callers supply the raw
 * value from their environment-appropriate source).
 *
 * Returns the normalized URL without a trailing slash, or the
 * `AIFETCHLY_WEBSITE_URL` fallback when the input is missing or invalid.
 */
export function resolveAboutWebsiteUrl(raw: unknown): string {
  if (typeof raw !== "string") {
    return AIFETCHLY_WEBSITE_URL;
  }
  let s: string = raw.trim().replace(/^\uFEFF/, "");
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).trim().replace(/^\uFEFF/, "");
  } else if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    s = s.slice(1, -1).trim().replace(/^\uFEFF/, "");
  }
  if (s.length === 0 || s === "undefined" || s === "null") {
    return AIFETCHLY_WEBSITE_URL;
  }
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return AIFETCHLY_WEBSITE_URL;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return AIFETCHLY_WEBSITE_URL;
  }
  return parsed.toString().replace(/\/+$/, "");
}

/**
 * Public privacy-policy URL. Linked from the AI-content-report dialog
 * (PRD FR-2.6) and other consent surfaces. Safe to import from renderer or
 * main process. Must be kept in sync with the published page.
 */
export const AIFETCHLY_PRIVACY_POLICY_URL =
  "https://www.sellart-online.com/privacy-policy";

/**
 * GitHub repository that hosts Releases consumed by `update-electron-app`
 * via the public `https://update.electronjs.org` feed.
 */
export const AIFETCHLY_UPDATE_REPO = "robertzengcn/aiFetchly";

/**
 * Interval between automatic background update checks. `update-electron-app`
 * enforces a 5 minute minimum.
 */
export const AIFETCHLY_UPDATE_INTERVAL = "1 hour";
