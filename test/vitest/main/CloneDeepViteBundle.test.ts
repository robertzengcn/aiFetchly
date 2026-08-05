import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(
  testDir,
  "fixtures",
  "mergeDeepViteEntry.mjs"
);

/**
 * Regression for packaged ScheduleManager crash:
 *   TypeError: n.typeOf is not a function
 *
 * Root cause: clone-deep@0.2.x (via puppeteer-extra-plugin → merge-deep) uses
 * lazy-cache. When Vite/Rollup bundles that graph into a main-process chunk,
 * utils.typeOf is never registered as a function and module load throws.
 *
 * package.json resolutions pin clone-deep@4.0.1. This test builds a minimal
 * Vite CJS bundle of merge-deep (same packaging path) and executes it so a
 * resolution / lockfile regression fails CI instead of Windows packaging.
 */
describe("clone-deep Vite bundle typeOf regression", () => {
  it("resolves clone-deep 4.x without lazy-cache", () => {
    const cloneDeepPkg = JSON.parse(
      fs.readFileSync(require.resolve("clone-deep/package.json"), "utf-8")
    ) as {
      version: string;
      dependencies?: Record<string, string>;
    };

    expect(cloneDeepPkg.version.startsWith("4.")).toBe(true);
    expect(cloneDeepPkg.dependencies?.["lazy-cache"]).toBeUndefined();

    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")
    ) as { resolutions?: Record<string, string> };

    expect(packageJson.resolutions?.["clone-deep"]).toBe("4.0.1");
  });

  it("survives Vite CJS bundling of merge-deep without typeOf crash", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-clone-deep-vite-")
    );
    const outDir = path.join(tempRoot, "dist");
    const bundlePath = path.join(outDir, "merge-bundle.cjs");

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
            fileName: () => "merge-bundle.cjs",
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
      expect(combinedOutput).not.toMatch(/typeOf is not a function/i);
      expect(run.status).toBe(0);
      expect(combinedOutput).toContain("merge-deep-vite-ok");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
