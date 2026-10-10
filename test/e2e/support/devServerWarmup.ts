/**
 * Vite dev-server warmup for specs that navigate lazy inner routes.
 *
 * The E2E renderer loads from the vite dev server. The first time a lazy
 * route module is requested, vite discovers its dependencies (e.g. vuetify
 * table internals on the Plugins page) and re-optimizes, broadcasting a
 * FULL-PAGE RELOAD to every connected client ("optimized dependencies
 * changed. reloading"). A reload like that mid-test re-lands the app on the
 * current hash route and swallows any click dispatched in the same window —
 * observed as intermittent "still on the inner page after New chat" flakes.
 *
 * Requesting the lazy modules here — before any Electron renderer connects —
 * moves dependency discovery and the reload broadcast to a moment when no
 * page is connected. The server caches transforms, so repeated warmups are
 * a few cheap requests.
 */

import { RENDERER_ORIGIN } from "../fixtures/types";

/** Dev-server module URLs of the lazy pages the shell specs navigate to. */
const LAZY_ROUTE_MODULES = [
  "/src/views/pages/insights/index.vue",
  "/src/views/pages/knowledge/KnowledgeLibrary.vue",
  "/src/views/pages/systemsetting/plugins.vue",
] as const;

let warmup: Promise<void> | null = null;

async function warm(): Promise<void> {
  for (const moduleUrl of LAZY_ROUTE_MODULES) {
    try {
      const response = await fetch(`${RENDERER_ORIGIN}${moduleUrl}`);
      // Drain the body so the module transform fully completes server-side.
      await response.arrayBuffer();
    } catch {
      // Warmup is best-effort: an unreachable dev server surfaces loudly in
      // the fixture launch step, which owns the authoritative error.
    }
  }
  // Give a just-triggered dependency optimization time to finish and fire
  // its reload broadcast while no renderer is connected yet.
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/** Idempotent per test-runner process. */
export function warmLazyRouteModules(): Promise<void> {
  warmup ??= warm();
  return warmup;
}
