import { resolveAboutWebsiteUrl } from "@/config/appInfo";

/**
 * Renderer-side About-page website URL.
 *
 * This is a RENDERER module — `import.meta.env` is the correct and supported
 * pattern here (unlike the main-process bundle; see
 * `src/config/viteLoginUrl.ts`). Vite exposes `VITE_LOGIN_URL` from `.env`
 * at build time via `import.meta.env`.
 *
 * Falls back to the `AIFETCHLY_WEBSITE_URL` constant when the variable is
 * missing or invalid (same normalization as the main process).
 */
export function getRendererWebsiteUrl(): string {
  const raw: unknown = import.meta.env.VITE_LOGIN_URL;
  return resolveAboutWebsiteUrl(raw);
}
