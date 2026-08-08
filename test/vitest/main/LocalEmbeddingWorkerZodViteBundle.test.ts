import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAndRunViteCjsBundle } from "./helpers/viteCjsBundle";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(
  testDir,
  "fixtures",
  "localEmbeddingZodEntry.mjs"
);
const configPath = path.resolve(
  process.cwd(),
  "vite.localEmbeddingWorker.config.mjs"
);
const sharedPath = path.resolve(process.cwd(), "vite.workerSsrNoExternal.mjs");

/**
 * Regression: downloadable embedding-xenova worker.js used to emit
 *   require("zod")
 * which crashes when forked from userData (runtime does not ship zod;
 * NODE_PATH→asar is unreliable for external workers).
 *
 * vite.localEmbeddingWorker.config.mjs must keep zod in ssr.noExternal so
 * the worker is self-contained. This suite locks the config contract and
 * rebuilds a minimal zod import with the same noExternal setting — CI does
 * not pre-build dist/childprocess/LocalEmbeddingWorker.js before testmain.
 */
describe("LocalEmbeddingWorker zod Vite bundle packaging", () => {
  it("lists zod in ssr.noExternal via ZOD_SSR_NO_EXTERNAL", () => {
    const config = fs.readFileSync(configPath, "utf-8");
    const shared = fs.readFileSync(sharedPath, "utf-8");
    expect(config).toMatch(/noExternal:\s*ZOD_SSR_NO_EXTERNAL/);
    expect(shared).toMatch(/ZOD_SSR_NO_EXTERNAL\s*=\s*\[["']zod["']\]/);
    const externalMatch = config.match(
      /rollupOptions:\s*\{[\s\S]*?external:\s*\[([\s\S]*?)\]/
    );
    expect(externalMatch).not.toBeNull();
    expect(externalMatch?.[1]).not.toMatch(/["']zod["']/);
  });

  it("inlines zod when ssr.noExternal includes zod (no bare require)", async () => {
    const withZodBundled = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-embed-zod-bundled-",
      fileName: "embed-zod-bundled.cjs",
      ssrNoExternal: ["zod"],
      skipRun: true,
      minify: false,
    });
    expect(withZodBundled.code).not.toMatch(
      /require\(\s*["']zod(?:\/v4)?["']\s*\)/
    );
    expect(withZodBundled.code).toMatch(/node_modules\/zod\//);

    const withZodExternal = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-embed-zod-external-",
      fileName: "embed-zod-external.cjs",
      external: ["zod"],
      skipRun: true,
      minify: false,
    });
    expect(withZodExternal.code).toMatch(/require\(\s*["']zod["']\s*\)/);
  });
});
