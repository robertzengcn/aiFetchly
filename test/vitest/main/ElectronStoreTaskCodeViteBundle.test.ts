import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(
  testDir,
  "fixtures",
  "electronStoreViteEntry.mjs"
);
const taskCodeViteConfigPath = path.resolve(
  process.cwd(),
  "vite.taskCode.config.mjs"
);

const ELECTRON_STORE_RUNTIME_DEPS = [
  "electron-store",
  "conf",
  "type-fest",
  "ajv",
  "ajv-formats",
  "atomically",
  "debounce-fn",
  "dot-prop",
  "env-paths",
  "fast-deep-equal",
  "fast-uri",
  "find-up",
  "is-obj",
  "json-schema-traverse",
  "json-schema-typed",
  "locate-path",
  "mimic-fn",
  "onetime",
  "p-limit",
  "p-locate",
  "p-try",
  "path-exists",
  "pkg-up",
  "require-from-string",
  "semver",
] as const;

/**
 * Regression for packaged taskCode worker crash:
 *   Error: Cannot find module 'electron-store'
 *   Require stack: .../app.asar.unpacked/.vite/build/taskCode.js
 *
 * SSR Vite builds externalize node_modules by default. taskCode must list
 * electron-store and its pure-JS dependency tree in ssr.noExternal so the
 * packaged worker (loaded from app.asar.unpacked) does not emit a bare
 * require for electron-store. The real store is required for Token /
 * USER_AI_ENABLED — do not substitute the ContactExtractionWorker shim.
 */
describe("taskCode electron-store Vite bundle packaging", () => {
  it("lists electron-store in ssr.noExternal in vite.taskCode.config.mjs", () => {
    const config = fs.readFileSync(taskCodeViteConfigPath, "utf-8");

    expect(config).toMatch(/noExternal:\s*\[/);
    expect(config).toContain("'electron-store'");
    expect(config).toContain("'conf'");
    // Must not alias away the real store for taskCode.
    expect(config).not.toMatch(
      /["']electron-store["']\s*:\s*path\.resolve\([\s\S]*electron-shim/
    );
  });

  it("SSR build with taskCode noExternal list inlines electron-store", async () => {
    const { build } = require("vite") as {
      build: (inlineConfig: Record<string, unknown>) => Promise<unknown>;
    };
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-taskcode-estore-ssr-")
    );
    const outDir = path.join(tempRoot, "dist");

    try {
      await build({
        configFile: false,
        root: process.cwd(),
        logLevel: "error",
        resolve: {
          conditions: ["node"],
        },
        ssr: {
          noExternal: [...ELECTRON_STORE_RUNTIME_DEPS],
        },
        build: {
          outDir,
          emptyOutDir: true,
          ssr: true,
          rollupOptions: {
            input: fixtureEntryPath,
            output: {
              entryFileNames: "electronStoreBundle.js",
              format: "cjs",
            },
            external: ["electron"],
          },
        },
      });

      const bundlePath = path.join(outDir, "electronStoreBundle.js");
      expect(fs.existsSync(bundlePath)).toBe(true);
      const code = fs.readFileSync(bundlePath, "utf-8");
      expect(code).not.toMatch(/require\(["']electron-store["']\)/);
      expect(code).not.toMatch(/require\(["']conf["']\)/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
