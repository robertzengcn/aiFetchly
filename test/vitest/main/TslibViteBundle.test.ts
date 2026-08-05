import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAndRunViteCjsBundle } from "./helpers/viteCjsBundle";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(testDir, "fixtures", "tslibViteEntry.mjs");
const tslibCjsPath = path.resolve(process.cwd(), "node_modules/tslib/tslib.js");
const viteMainConfigPath = path.resolve(process.cwd(), "vite.main.config.mjs");

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
 * vite.main.config.mjs aliases `tslib` → node_modules/tslib/tslib.js and
 * externalizes pdf-lib. This test bundles the same import path with that
 * alias and executes the output so a packaging regression fails CI.
 */
describe("tslib Vite bundle __extends regression", () => {
  it("keeps the tslib CJS alias and pdf-lib external in vite.main.config", () => {
    const configSource = fs.readFileSync(viteMainConfigPath, "utf-8");
    expect(configSource).toContain("node_modules/tslib/tslib.js");
    expect(configSource).toMatch(/["']tslib["']\s*:/);
    expect(configSource).toMatch(/["']pdf-lib["']/);
    expect(fs.existsSync(tslibCjsPath)).toBe(true);
  });

  it("crashes without the tslib CJS alias (documents the packaging failure mode)", async () => {
    const result = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-tslib-vite-broken-",
      fileName: "tslib-bundle.cjs",
    });

    expect(result.run).not.toBeNull();
    expect(result.run?.status).not.toBe(0);
    expect(result.combinedOutput).toMatch(
      /Cannot destructure property '__extends'.*\.default/i
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
