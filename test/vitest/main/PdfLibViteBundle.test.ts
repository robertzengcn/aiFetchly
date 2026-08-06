import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAndRunViteCjsBundle } from "./helpers/viteCjsBundle";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(testDir, "fixtures", "pdfLibViteEntry.mjs");
const viteMainConfigPath = path.resolve(process.cwd(), "vite.main.config.mjs");
const forgeConfigPath = path.resolve(process.cwd(), "forge.config.js");

/**
 * Regression for packaged ScheduleManager / Windows launch crash:
 *   TypeError: Cannot destructure property '__extends' of '….default' as it is undefined
 *   at ScheduleManager-*.js (via pdf-lib → nested tslib/modules/index.js)
 *
 * pdf-lib is already in forge EXTERNAL_DEPENDENCIES. vite.main.config.mjs must
 * also mark it external (and alias tslib to CJS) so Vite never rewrites the
 * ESM+tslib graph into a main-process startup chunk.
 *
 * Runtime crash details for the tslib interop itself are covered by
 * TslibViteBundle.test.ts (small fixture; Node can print the TypeError).
 * This suite covers the pdf-lib packaging path end-to-end.
 */
describe("pdf-lib Vite bundle packaging regression", () => {
  it("keeps pdf-lib external in vite.main and forge EXTERNAL_DEPENDENCIES", () => {
    const viteMain = fs.readFileSync(viteMainConfigPath, "utf-8");
    const forge = fs.readFileSync(forgeConfigPath, "utf-8");

    expect(viteMain).toMatch(/external\s*:\s*\[[\s\S]*['"]pdf-lib['"]/);
    expect(viteMain).toContain("node_modules/tslib/tslib.js");
    expect(forge).toMatch(
      /EXTERNAL_DEPENDENCIES\s*=\s*\[[\s\S]*['"]pdf-lib['"]/
    );
  });

  it("emits the broken tslib __extends.default interop when pdf-lib is bundled", async () => {
    // Do not execute: a minified one-line pdf-lib bundle overflows Node's
    // error printer and hides the TypeError. Static pattern check is enough
    // to prove why packaging must externalize pdf-lib / alias tslib.
    const result = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-pdf-lib-vite-pattern-",
      fileName: "pdf-lib-bundle.cjs",
      skipRun: true,
    });

    // Destructuring pattern is `{__extends:…,…}=interop(…).default`.
    // The RHS embeds the whole tslib UMD factory, so only bound the LHS tightly.
    expect(result.code).toMatch(
      /\{__extends:[^}]+\}=\s*[\s\S]{0,200000}?\.default/
    );
  });

  it("loads when pdf-lib is externalized like vite.main.config packaging", async () => {
    const result = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-pdf-lib-vite-external-",
      fileName: "pdf-lib-bundle.cjs",
      external: ["pdf-lib", "tslib"],
      nodePathModules: true,
    });

    expect(result.code).toMatch(/require\(["']pdf-lib["']\)/);
    expect(result.code).not.toMatch(/__extends/);
    expect(result.run).not.toBeNull();
    expect(result.combinedOutput).not.toMatch(
      /Cannot destructure property ['"]__extends['"]/i
    );
    expect(result.run?.status).toBe(0);
    expect(result.combinedOutput).toContain("pdf-lib-vite-ok");
  });

  it("loads when tslib is aliased to the CJS entry (belt-and-suspenders)", async () => {
    const tslibCjsPath = path.resolve(
      process.cwd(),
      "node_modules/tslib/tslib.js"
    );

    const result = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-pdf-lib-vite-tslib-alias-",
      fileName: "pdf-lib-bundle.cjs",
      alias: { tslib: tslibCjsPath },
    });

    expect(result.run).not.toBeNull();
    expect(result.combinedOutput).not.toMatch(
      /Cannot destructure property ['"]__extends['"]/i
    );
    expect(result.run?.status).toBe(0);
    expect(result.combinedOutput).toContain("pdf-lib-vite-ok");
  });
});
