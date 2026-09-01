import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAndRunViteCjsBundle } from "./helpers/viteCjsBundle";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(testDir, "fixtures", "tslibViteEntry.mjs");
const tslibCjsPath = path.resolve(process.cwd(), "node_modules/tslib/tslib.js");
const viteMainConfigPath = path.resolve(process.cwd(), "vite.main.config.mjs");
// The resolve aliases and externals list were extracted into a shared module
// so the Playwright E2E main build can reuse them (design §6.4). The tslib
// CJS alias and pdf-lib external now live there; vite.main.config.mjs only
// wires them in via imports.
const viteMainSharedPath = path.resolve(process.cwd(), "vite.main.shared.mjs");

/**
 * Regression for packaged ScheduleManager crash:
 *   TypeError: Cannot destructure property '__extends' of '….default' as it is undefined
 *
 * Root cause: Vite resolves `import { __extends } from "tslib"` to
 * tslib/modules/index.js, which default-imports the CJS tslib.js and
 * destructures helpers. Under Electron CJS output that interop leaves
 * `.default` undefined (seen via pdf-lib → nested tslib in the
 * ScheduleManager chunk).
 *
 * The main bundle aliases `tslib` → node_modules/tslib/tslib.js and
 * externalizes pdf-lib. This test bundles the same import path with that
 * alias and executes the output so a packaging regression fails CI.
 */
describe("tslib Vite bundle __extends regression", () => {
  it("keeps the tslib CJS alias and pdf-lib external in the shared main config", () => {
    // Check the shared module (authoritative home of the alias/external)
    // and the config file that wires it in, so removing the alias from
    // either location fails CI.
    const sharedSource = fs.readFileSync(viteMainSharedPath, "utf-8");
    const configSource = fs.readFileSync(viteMainConfigPath, "utf-8");
    const combined = `${sharedSource}\n${configSource}`;
    expect(combined).toContain("node_modules/tslib/tslib.js");
    // Accept both quoted ("tslib":) and unquoted (tslib:) object keys; the
    // shared module uses the unquoted form `tslib: path.resolve(...)`.
    expect(combined).toMatch(/["']?tslib["']?\s*:/);
    expect(combined).toMatch(/["']pdf-lib["']/);
    expect(fs.existsSync(tslibCjsPath)).toBe(true);
  });

  it("emits broken tslib __extends.default interop when tslib is not aliased to CJS", async () => {
    // Vite 8 may execute this bundle successfully in Node even though the
    // emitted interop still destructures from `.default` (the Electron CJS
    // packaging failure mode). Static pattern check is the stable signal.
    const result = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-tslib-vite-broken-",
      fileName: "tslib-bundle.cjs",
      skipRun: true,
    });

    expect(result.code).toMatch(
      /\{__extends:[^}]+\}=\s*[\s\S]{0,200000}?\.default/
    );
  });

  it("survives Vite CJS bundling when tslib is aliased to the CJS entry", async () => {
    const result = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-tslib-vite-fixed-",
      fileName: "tslib-bundle.cjs",
      alias: { tslib: tslibCjsPath },
    });

    expect(result.combinedOutput).not.toMatch(
      /Cannot destructure property '__extends'/i
    );
    expect(result.run).not.toBeNull();
    expect(result.run?.status).toBe(0);
    expect(result.combinedOutput).toContain("tslib-vite-ok");
  });
});
