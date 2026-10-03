import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAndRunViteCjsBundle } from "./helpers/viteCjsBundle";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(
  testDir,
  "fixtures",
  "electronLogViteEntry.mjs"
);
const taskCodeViteConfigPath = path.resolve(
  process.cwd(),
  "vite.taskCode.config.mjs"
);

/**
 * Regression for GitHub Actions build failure (run #288, build-macos and
 * build-windows):
 *   Unresolvable packaged runtime dependencies:
 *   - .../app.asar.unpacked/.vite/build/taskCode.js requires electron-log:
 *     package is not in app.asar.unpacked/node_modules (only inside app.asar).
 *
 * src/modules/Logger.ts (pulled into the taskCode graph via outbound-email
 * services) calls require("electron-log/main"). SSR Vite builds externalize
 * node_modules by default, so the packaged taskCode worker emitted a bare
 * require("electron-log") that cannot be resolved from app.asar.unpacked on
 * Windows/macOS utility processes. electron-log is pure JS with zero runtime
 * dependencies, so vite.taskCode.config.mjs lists it in ssr.noExternal to
 * bundle it into the worker.
 */
describe("taskCode electron-log Vite bundle packaging", () => {
  it("lists electron-log in ssr.noExternal in vite.taskCode.config.mjs", () => {
    const config = fs.readFileSync(taskCodeViteConfigPath, "utf-8");

    expect(config).toMatch(/noExternal:\s*\[/);
    expect(config).toContain("'electron-log'");
    // electron-log must never be marked external for the packaged worker.
    const externalMatch = config.match(
      /rollupOptions:\s*\{[\s\S]*?external:\s*\[([\s\S]*?)\]/
    );
    expect(externalMatch).not.toBeNull();
    expect(externalMatch?.[1]).not.toMatch(/["']electron-log["']/);
  });

  it("inlines electron-log when ssr.noExternal includes it (no bare require)", async () => {
    const withLogBundled = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-taskcode-elog-bundled-",
      fileName: "taskcode-elog-bundled.cjs",
      ssrNoExternal: ["electron-log"],
      external: ["electron"],
      skipRun: true,
      minify: false,
    });
    expect(withLogBundled.code).not.toMatch(
      /require\(\s*["']electron-log(?:\/main)?["']\s*\)/
    );
    expect(withLogBundled.code).toMatch(/node_modules\/electron-log\//);

    // Counter-proof: without noExternal, an externalized electron-log import
    // emits the exact bare require that fails from app.asar.unpacked.
    const withLogExternal = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-taskcode-elog-external-",
      fileName: "taskcode-elog-external.cjs",
      external: ["electron", "electron-log", "electron-log/main"],
      skipRun: true,
      minify: false,
    });
    expect(withLogExternal.code).toMatch(
      /require\(\s*["']electron-log(?:\/main)?["']\s*\)/
    );
  });
});
