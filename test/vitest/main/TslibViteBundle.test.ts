import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(testDir, "fixtures", "tslibViteEntry.mjs");
const tslibCjsPath = path.resolve(process.cwd(), "node_modules/tslib/tslib.js");
const viteMainConfigPath = path.resolve(process.cwd(), "vite.main.config.mjs");

/**
 * Vite 8 only exposes types via package "exports", which need
 * moduleResolution node16/nodenext/bundler. This project's tsconfig uses
 * "node", so a static `import { build } from "vite"` fails `tsc --noEmit`.
 * Load via createRequire and a narrow local type instead.
 */
interface ViteBuildFn {
  (inlineConfig: Record<string, unknown>): Promise<unknown>;
}

const { build } = require("vite") as { build: ViteBuildFn };

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
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-tslib-vite-broken-")
    );
    const outDir = path.join(tempRoot, "dist");
    const bundlePath = path.join(outDir, "tslib-bundle.cjs");

    try {
      await build({
        configFile: false,
        root: process.cwd(),
        logLevel: "error",
        build: {
          lib: {
            entry: fixtureEntryPath,
            formats: ["cjs"],
            fileName: () => "tslib-bundle.cjs",
          },
          outDir,
          emptyOutDir: true,
          minify: true,
          target: "node18",
          commonjsOptions: {
            transformMixedEsModules: true,
            include: [/node_modules/],
          },
          rollupOptions: {
            external: [
              "fs",
              "path",
              "os",
              "crypto",
              "util",
              "stream",
              "events",
              "buffer",
              "url",
            ],
          },
        },
        resolve: {
          conditions: ["node"],
        },
      });

      expect(fs.existsSync(bundlePath)).toBe(true);

      const run = spawnSync(process.execPath, [bundlePath], {
        cwd: process.cwd(),
        encoding: "utf-8",
        env: { ...process.env },
      });

      const combinedOutput = `${run.stdout}\n${run.stderr}`;
      expect(run.status).not.toBe(0);
      expect(combinedOutput).toMatch(
        /Cannot destructure property '__extends'.*\.default/i
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("survives Vite CJS bundling when tslib is aliased to the CJS entry", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-tslib-vite-fixed-")
    );
    const outDir = path.join(tempRoot, "dist");
    const bundlePath = path.join(outDir, "tslib-bundle.cjs");

    try {
      expect(fs.existsSync(fixtureEntryPath)).toBe(true);

      await build({
        configFile: false,
        root: process.cwd(),
        logLevel: "error",
        build: {
          lib: {
            entry: fixtureEntryPath,
            formats: ["cjs"],
            fileName: () => "tslib-bundle.cjs",
          },
          outDir,
          emptyOutDir: true,
          minify: true,
          target: "node18",
          commonjsOptions: {
            transformMixedEsModules: true,
            include: [/node_modules/],
          },
          rollupOptions: {
            external: [
              "fs",
              "path",
              "os",
              "crypto",
              "util",
              "stream",
              "events",
              "buffer",
              "url",
            ],
          },
        },
        resolve: {
          conditions: ["node"],
          alias: {
            tslib: tslibCjsPath,
          },
        },
      });

      expect(fs.existsSync(bundlePath)).toBe(true);

      const run = spawnSync(process.execPath, [bundlePath], {
        cwd: process.cwd(),
        encoding: "utf-8",
        env: { ...process.env },
      });

      const combinedOutput = `${run.stdout}\n${run.stderr}`;
      expect(combinedOutput).not.toMatch(
        /Cannot destructure property '__extends'/i
      );
      expect(run.status).toBe(0);
      expect(combinedOutput).toContain("tslib-vite-ok");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
