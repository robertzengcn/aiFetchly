import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

/**
 * Worker vite configs whose packaged bundles emitted a bare `require("zod")`
 * in the GitHub Actions "Build Electron App" failure (run #382, job
 * 124419068390 build-macos verify-packaged-childprocess exit):
 *
 *   Unresolvable packaged runtime dependencies:
 *   - .../app.asar.unpacked/.vite/build/GoogleMapsWorker.js requires zod:
 *     package is not in app.asar.unpacked/node_modules (only inside app.asar)
 *
 * zod is pure JS, so like taskCode/localEmbedding/contactExtraction/etc.
 * these workers must bundle zod via the shared ZOD_SSR_NO_EXTERNAL constant
 * instead of relying on NODE_PATH into app.asar. Linux CI smoke never caught
 * these because its FORGE_DISABLE_ASAR=1 layout can resolve node_modules
 * from resources/app — the check only enforces unpacked-worker policy on
 * real asar builds (macOS/Windows).
 */
const CONFIG_FILES = [
  "vite.googleMapsWorker.config.mjs",
  "vite.yandexMapsWorker.config.mjs",
  "vite.pythonRuntimeWorker.config.mjs",
  "vite.skillWorker.config.mjs",
  "vite.googleProxyCheck.config.mjs",
  "vite.websiteContentScraper.config.mjs",
  // Caught by a local sweep after the run #382 fix: same bare
  // require("zod") class, only invisible to verify-packaged-childprocess
  // because ManagedBrowser/ManagedBrowserCacheWorker are runtime-spawned
  // workers outside the script's REQUIRED_WORKERS list.
  "vite.managedBrowserWorker.config.mjs",
  "vite.managedBrowserCacheWorker.config.mjs",
];

const SHARED_NO_EXTERNAL_PATH = path.join(
  projectRoot,
  "vite.workerSsrNoExternal.mjs"
);

describe("worker vite configs force-bundle zod (run #382 asar failure)", () => {
  it("keeps zod (pure JS) defined exactly once in the shared constant", () => {
    const shared = fs.readFileSync(SHARED_NO_EXTERNAL_PATH, "utf-8");
    expect(shared).toMatch(/ZOD_SSR_NO_EXTERNAL\s*=\s*\[["']zod["']\]/);
  });

  for (const configFile of CONFIG_FILES) {
    it(`${configFile} lists ZOD_SSR_NO_EXTERNAL in ssr.noExternal and never externalizes zod`, () => {
      const config = fs.readFileSync(path.join(projectRoot, configFile), "utf-8");

      // Imports the shared constant — not a hand-rolled copy.
      expect(config).toMatch(
        /import\s*\{[^}]*ZOD_SSR_NO_EXTERNAL[^}]*\}\s*from\s*["']\.\/vite\.workerSsrNoExternal\.mjs["']/
      );

      // The constant is actually consumed by an ssr.noExternal block (either
      // `noExternal: ZOD_SSR_NO_EXTERNAL` or a spread among other packages).
      const consumesSharedConstant = [
        /noExternal\s*:\s*\[[^\]]*\.\.\.ZOD_SSR_NO_EXTERNAL/,
        /noExternal\s*:\s*ZOD_SSR_NO_EXTERNAL/,
      ].some((pattern) => pattern.test(config));
      expect(consumesSharedConstant).toBe(true);

      // Nothing in any rollup `external` array may externalize zod again.
      const externalArrays = [
        ...(config.match(/external:\s*\[([\s\S]*?)\]/g) ?? []),
      ].join("\n");
      expect(externalArrays).not.toMatch(/["']zod(?:\/v\d+)?["']/);
    });
  }
});
