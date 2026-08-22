/**
 * AiFetchly Plugin Hub (community catalog) configuration.
 *
 * IMPORTANT: Do NOT use `import.meta.env` here. In Electron's packaged ASAR
 * environment, Vite's transformation of `import.meta` generates a
 * `new URL(import.meta.url)` call internally, which fails because ASAR paths
 * are not valid file:// URLs recognised by Node's URL parser.
 *
 * Instead, `process.env.VITE_PLUGIN_HUB_URL` is embedded at build time via
 * Vite's `define` option in `vite.main.config.mjs` (same pattern as
 * `VITE_LOGIN_URL` in `src/config/viteLoginUrl.ts`). Developers point it at
 * the hub's docker-compose (`http://localhost:8080`) via `.env`; production
 * builds bake in the public hub URL.
 *
 * The hub URL is a first-party constant — never user input. The desktop
 * forwards the marketing JWT to this origin only (assertFirstPartyHubUrl
 * enforces that), so the token can never be attached to a third-party URL.
 */

export interface PluginHubResolved {
  value: string;
}

/** Production hub base URL (placeholder origin — confirm with product). */
export const PLUGIN_HUB_PROD_URL = "https://plugins.aifetchly.com";

/**
 * Reserved marketplace-row name for the built-in hub marketplace.
 * Slug-safe (matches MARKETPLACE_NAME_REGEX) so it can never collide with a
 * marketplace a user adds from a manifest whose names must be slug-safe too.
 */
export const HUB_MARKETPLACE_NAME = "aifetch-plugin-hub";

/** Display name for the built-in hub marketplace row / manifest owner. */
export const HUB_MARKETPLACE_DISPLAY_NAME = "AiFetchly Plugin Hub";

/** Catalog endpoint on the hub (PRD §7.4 / hub tech design §9). */
export const PLUGIN_HUB_CATALOG_PATH = "/api/v1/plugins/catalog";

/**
 * Marketing plans page opened by the Upgrade CTA via shell.openExternal.
 * Hard-coded constant — never from user input (PRD §7.7 / §13.3).
 */
export const MARKETING_PLANS_URL = "https://www.sellart-online.com/pricing";

/**
 * Trim, strip UTF-8 BOM, and remove a single pair of surrounding ASCII quotes
 * so `.env` / editor quirks do not break `new URL()` (mirrors
 * normalizeViteLoginUrlString in viteLoginUrl.ts).
 */
export function normalizePluginHubUrlString(raw: string): string {
  let s = raw.trim().replace(/^\uFEFF/, "");
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1).trim().replace(/^\uFEFF/, "");
  }
  return s;
}

/**
 * Returns the plugin hub base URL. `process.env.VITE_PLUGIN_HUB_URL` is
 * replaced with a string literal at build time by vite.main.config.mjs
 * `define`; when unset (or invalid) the production hub URL is used.
 */
export function resolvePluginHubBase(): PluginHubResolved {
  const raw: string | undefined = process.env.VITE_PLUGIN_HUB_URL;
  let v = typeof raw === "string" ? normalizePluginHubUrlString(raw) : "";
  if (v.length === 0) {
    v = PLUGIN_HUB_PROD_URL;
  }
  try {
    new URL(v);
  } catch {
    v = PLUGIN_HUB_PROD_URL;
  }
  return { value: v };
}

/**
 * Throws unless `url` is on the same origin as the resolved hub base.
 * Guards HttpClient.getFirstParty() so the marketing JWT is only ever
 * attached to the first-party hub origin.
 */
export function assertFirstPartyHubUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Refusing non-URL request: ${url}`);
  }
  const base = new URL(resolvePluginHubBase().value);
  if (parsed.origin !== base.origin) {
    throw new Error(
      `Refusing to send credentials to non-first-party origin "${parsed.origin}" (hub base is "${base.origin}")`
    );
  }
}
