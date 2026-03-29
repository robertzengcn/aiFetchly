/**
 * Resolves the marketing / login base URL for the Electron main process.
 *
 * IMPORTANT: Do NOT use `import.meta.env` here. In Electron's packaged ASAR
 * environment, Vite's transformation of `import.meta` generates a
 * `new URL(import.meta.url)` call internally, which fails because ASAR paths
 * are not valid file:// URLs recognised by Node's URL parser.
 *
 * Instead, `process.env.VITE_LOGIN_URL` is embedded at build time via Vite's
 * `define` option in `vite.main.config.mjs`. CI writes the secret to `.env`
 * as `VITE_LOGIN_URL=<value>` before building, and the Vite config calls
 * `loadEnv()` so `process.env.VITE_LOGIN_URL` is populated at build time.
 */

export type ViteLoginResolved = {
  value: string;
  source: "process.env.VITE_LOGIN_URL";
};

/**
 * Trim, strip UTF-8 BOM, and remove a single pair of surrounding ASCII quotes
 * so `.env` / editor quirks do not break `new URL()`.
 */
export function normalizeViteLoginUrlString(raw: string): string {
  let s = raw.trim().replace(/^\uFEFF/, "");
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s
      .slice(1, -1)
      .trim()
      .replace(/^\uFEFF/, "");
  }
  return s;
}

/**
 * Returns the login base URL, or `undefined` if not configured.
 *
 * `process.env.VITE_LOGIN_URL` is replaced with the actual URL string at
 * build time by the `define` option in `vite.main.config.mjs`, so the value
 * is baked into the bundle and available without any `.env` file at runtime.
 */
export function resolveViteLoginBase(): ViteLoginResolved | undefined {
  // Replaced with a string literal at build time via vite.main.config.mjs
  // define: { 'process.env.VITE_LOGIN_URL': JSON.stringify(...) }
  const raw: string | undefined = process.env.VITE_LOGIN_URL;
  if (typeof raw !== "string") return undefined;
  const t = normalizeViteLoginUrlString(raw);
  if (t.length === 0) return undefined;
  return { value: t, source: "process.env.VITE_LOGIN_URL" };
}
